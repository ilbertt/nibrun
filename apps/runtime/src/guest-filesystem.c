#include "guest-filesystem.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
/* renameat lives here rather than in fcntl.h, which is where the rest of the *at
 * family this file uses is declared. */
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <sys/wait.h>
#include <unistd.h>

#include "clock.h"
#include "log.h"
#include "paths.h"
#include "vsock.h"

/* Browsing is many small requests and an upload is many more, so a connection is
 * kept for as long as the peer keeps asking rather than spent on one exchange.
 * Concurrency is bounded instead: each connection costs a process, and what this
 * guest exists to run is the tenant. */
#define CONNECTION_BACKLOG 8
#define MAX_CONCURRENT_ANSWERS 4

/* How long a connection may sit between requests before this side takes its worker
 * back, and how long any one request has to finish arriving once it has started. */
#define IDLE_TIMEOUT_MS 30000
#define EXCHANGE_TIMEOUT_MS 5000

#define PATH_MAX_BYTES 4096
#define DIRENT_BATCH_BYTES 4096
#define TENANT_FILE_MODE 0644
#define TENANT_DIRECTORY_MODE 0755

static const unsigned char FRAME_MAGIC[GUEST_FILESYSTEM_MAGIC_BYTES] = {'N', 'B', 'F', '1'};

/* The two buffers, and the only ones a request can reach. They live on the stack of
 * whichever process is answering rather than in this binary's bss, so the guest pays
 * for them while a request is in flight and PID 1 — which forked long before either
 * existed — never pays for them at all. */
struct exchange_buffers {
  unsigned char request[GUEST_FILESYSTEM_BODY_MAX_BYTES];
  unsigned char reply[GUEST_FILESYSTEM_BODY_MAX_BYTES];
};

struct cursor {
  const unsigned char *bytes;
  size_t length;
  size_t offset;
};

struct writer {
  unsigned char *bytes;
  size_t capacity;
  size_t length;
};

/* Everything one verb needs, filled from the request body and nowhere else. The
 * paths are arrays rather than pointers into that body because resolving one writes
 * through it, terminating a segment at a time. */
struct operation {
  const char *mount_point;
  char path[PATH_MAX_BYTES];
  char destination[PATH_MAX_BYTES];
  uint64_t offset;
  uint32_t length;
  unsigned char flags;
  const unsigned char *content;
  uint32_t content_length;
};

static bool take(struct cursor *from, size_t count, const unsigned char **bytes) {
  if (from->length - from->offset < count) {
    return false;
  }
  *bytes = from->bytes + from->offset;
  from->offset += count;
  return true;
}

static uint64_t decode(const unsigned char *bytes, size_t count) {
  uint64_t value = 0;
  for (size_t index = 0; index < count; index++) {
    value = (value << CHAR_BIT) | bytes[index];
  }
  return value;
}

static bool take_u8(struct cursor *from, unsigned char *value) {
  const unsigned char *bytes = NULL;
  if (!take(from, 1, &bytes)) {
    return false;
  }
  *value = bytes[0];
  return true;
}

static bool take_u32(struct cursor *from, uint32_t *value) {
  const unsigned char *bytes = NULL;
  if (!take(from, sizeof(uint32_t), &bytes)) {
    return false;
  }
  *value = (uint32_t)decode(bytes, sizeof(uint32_t));
  return true;
}

/* Refused past the largest offset a file can hold, so that nothing below has to
 * wonder what an off_t cast did to it. */
static bool take_offset(struct cursor *from, uint64_t *value) {
  const unsigned char *bytes = NULL;
  if (!take(from, sizeof(uint64_t), &bytes)) {
    return false;
  }
  *value = decode(bytes, sizeof(uint64_t));
  return *value <= (uint64_t)INT64_MAX;
}

static bool take_field(struct cursor *from, const unsigned char **bytes, uint32_t *length) {
  return take_u32(from, length) && take(from, *length, bytes);
}

static bool room_for(const struct writer *into, size_t count) {
  return into->capacity - into->length >= count;
}

static void put(struct writer *into, const void *bytes, size_t count) {
  memcpy(into->bytes + into->length, bytes, count);
  into->length += count;
}

static void put_u8(struct writer *into, unsigned char value) {
  into->bytes[into->length] = value;
  into->length += 1;
}

static void put_wide(struct writer *into, uint64_t value, size_t count) {
  for (size_t index = 0; index < count; index++) {
    into->bytes[into->length + index] = (unsigned char)(value >> (CHAR_BIT * (count - index - 1)));
  }
  into->length += count;
}

/* A path arrives as bytes rather than as a string, because a filename may hold
 * anything but `/` and NUL and its length is what carries that. This is where it
 * becomes terminated, and where a NUL inside one becomes a refusal instead of a
 * path silently cut in half. */
static bool copy_path(const unsigned char *bytes, uint32_t length, char *path, size_t capacity) {
  if (length == 0 || length >= capacity || bytes[0] != '/') {
    return false;
  }
  if (memchr(bytes, '\0', length) != NULL) {
    return false;
  }
  memcpy(path, bytes, length);
  path[length] = '\0';
  return true;
}

static bool is_traversal(const char *segment, size_t length) {
  if (length == 1) {
    return segment[0] == '.';
  }
  return length == 2 && segment[0] == '.' && segment[1] == '.';
}

/* O_NOFOLLOW answers ELOOP on its own but ENOTDIR once O_DIRECTORY is on the same
 * open, which would report a symlink pointing out of the mount as though the tenant
 * had merely named a file. One stat, on the failure path only, tells the two apart
 * so that a refusal reads as the refusal it is. */
static int refusal_for(int parent, const char *name, int failure) {
  struct stat details;
  if (failure == ENOTDIR && fstatat(parent, name, &details, AT_SYMLINK_NOFOLLOW) == 0 &&
      S_ISLNK(details.st_mode)) {
    return ELOOP;
  }
  return failure;
}

/* Resolution is a walk: one segment at a time, each opened relative to the one
 * before it and none of them followed as a symlink. That is what scopes the whole
 * protocol to the tenant's mount — there is no path a tenant can create that this
 * walk resolves outside it, so nothing below compares prefixes, and no check can be
 * raced by a component swapped between deciding and opening. `.` and `..` are
 * refused rather than resolved for the same reason.
 *
 * Returns a descriptor on the directory holding the last segment, with `leaf`
 * pointing into `path` at that segment — or at NULL for the mount itself, which has
 * no parent here. `path` is written through: it is where the segments end. */
static int open_parent(const char *mount_point, char *path, const char **leaf) {
  int directory = open(mount_point, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (directory < 0) {
    return -1;
  }
  *leaf = NULL;
  char *segment = path + 1;
  while (*segment != '\0') {
    char *separator = strchr(segment, '/');
    size_t length = separator == NULL ? strlen(segment) : (size_t)(separator - segment);
    if (length == 0 || is_traversal(segment, length)) {
      close(directory);
      errno = EACCES;
      return -1;
    }
    if (separator == NULL) {
      *leaf = segment;
      return directory;
    }
    *separator = '\0';
    int child = openat(directory, segment, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    int failure = child < 0 ? refusal_for(directory, segment, errno) : 0;
    close(directory);
    if (child < 0) {
      errno = failure;
      return -1;
    }
    directory = child;
    segment = separator + 1;
  }
  return directory;
}

static enum guest_filesystem_status status_for(int failure) {
  switch (failure) {
    case ENOENT:
      return GUEST_FILESYSTEM_NOT_FOUND;
    case ENOTDIR:
    case EISDIR:
      return GUEST_FILESYSTEM_WRONG_KIND;
    case EEXIST:
      return GUEST_FILESYSTEM_EXISTS;
    case ENOTEMPTY:
      return GUEST_FILESYSTEM_NOT_EMPTY;
    /* ELOOP here is a symlink met with O_NOFOLLOW, which is less an error than this
     * side declining to leave the mount through a door the tenant built. */
    case ELOOP:
    case EACCES:
    case EPERM:
    case EXDEV:
      return GUEST_FILESYSTEM_DENIED;
    case ENAMETOOLONG:
      return GUEST_FILESYSTEM_MALFORMED;
    default:
      return GUEST_FILESYSTEM_FAILED;
  }
}

static unsigned char kind_of(mode_t mode) {
  if (S_ISDIR(mode)) {
    return GUEST_FILESYSTEM_DIRECTORY;
  }
  return S_ISREG(mode) ? GUEST_FILESYSTEM_FILE : GUEST_FILESYSTEM_OTHER;
}

static bool put_details(struct writer *into, const struct stat *details) {
  if (!room_for(into, GUEST_FILESYSTEM_DETAILS_BYTES)) {
    return false;
  }
  put_u8(into, kind_of(details->st_mode));
  put_wide(into, (uint64_t)details->st_size, sizeof(uint64_t));
  /* Two's complement, so a file dated before 1970 crosses as the negative it is. */
  put_wide(into, (uint64_t)details->st_mtime, sizeof(uint64_t));
  return true;
}

/* False once there is no room left, which is what ends a listing early. A name the
 * wire cannot carry is skipped instead — ext4 has none longer than 255 bytes, so
 * this is a bound being stated rather than a case that happens. */
static bool put_entry(struct writer *into, const char *name, const struct stat *details) {
  size_t length = strlen(name);
  if (length == 0 || length > UCHAR_MAX) {
    return true;
  }
  if (!room_for(into, GUEST_FILESYSTEM_DETAILS_BYTES + 1 + length)) {
    return false;
  }
  put_details(into, details);
  put_u8(into, (unsigned char)length);
  put(into, name, length);
  return true;
}

/* The filesystem's own bookkeeping, and never an entry: navigating upwards belongs
 * to whoever is browsing, not to the directory being browsed. */
static bool is_self_or_parent(const char *name) {
  return name[0] == '.' && (name[1] == '\0' || (name[1] == '.' && name[2] == '\0'));
}

/* getdents rather than opendir and readdir, which allocate: the tenant is meant to be
 * the only thing in this guest that does, and that is what makes it the right thing
 * for the OOM killer to reach for. The batch is a union so that the records the
 * kernel packs into it land aligned. */
union dirent_batch {
  struct dirent aligned;
  char bytes[DIRENT_BATCH_BYTES];
};

/* Takes ownership of `directory` however it returns. */
static enum guest_filesystem_status list_directory(int directory, struct writer *into) {
  if (!room_for(into, 1)) {
    close(directory);
    return GUEST_FILESYSTEM_FAILED;
  }
  size_t truncated = into->length;
  put_u8(into, 0);

  union dirent_batch batch;
  for (;;) {
    ssize_t seen = getdents(directory, &batch.aligned, sizeof(batch.bytes));
    if (seen <= 0) {
      enum guest_filesystem_status status =
          seen < 0 ? status_for(errno) : (enum guest_filesystem_status)GUEST_FILESYSTEM_OK;
      close(directory);
      return status;
    }
    for (size_t offset = 0; offset < (size_t)seen;) {
      const struct dirent *entry = (const struct dirent *)(void *)(batch.bytes + offset);
      offset += entry->d_reclen;
      if (is_self_or_parent(entry->d_name)) {
        continue;
      }
      struct stat details;
      /* An entry the tenant unlinked between listing it and this stat is one there is
       * nothing left to describe; the rest of the directory is still worth answering. */
      if (fstatat(directory, entry->d_name, &details, AT_SYMLINK_NOFOLLOW) < 0) {
        continue;
      }
      if (!put_entry(into, entry->d_name, &details)) {
        into->bytes[truncated] = 1;
        close(directory);
        return GUEST_FILESYSTEM_OK;
      }
    }
  }
}

static enum guest_filesystem_status perform_list(struct operation *asked, struct writer *into) {
  const char *leaf = NULL;
  int parent = open_parent(asked->mount_point, asked->path, &leaf);
  if (parent < 0) {
    return status_for(errno);
  }
  if (leaf == NULL) {
    return list_directory(parent, into);
  }
  int directory = openat(parent, leaf, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  int failure = directory < 0 ? refusal_for(parent, leaf, errno) : 0;
  close(parent);
  return directory < 0 ? status_for(failure) : list_directory(directory, into);
}

static enum guest_filesystem_status perform_stat(struct operation *asked, struct writer *into) {
  const char *leaf = NULL;
  int parent = open_parent(asked->mount_point, asked->path, &leaf);
  if (parent < 0) {
    return status_for(errno);
  }
  struct stat details;
  int described = leaf == NULL ? fstat(parent, &details)
                               : fstatat(parent, leaf, &details, AT_SYMLINK_NOFOLLOW);
  int failure = errno;
  close(parent);
  if (described < 0) {
    return status_for(failure);
  }
  return put_details(into, &details) ? GUEST_FILESYSTEM_OK : GUEST_FILESYSTEM_FAILED;
}

/* The mount itself is not a file, and every verb below acts on one. */
static int open_leaf_parent(struct operation *asked, const char **leaf) {
  int parent = open_parent(asked->mount_point, asked->path, leaf);
  if (parent >= 0 && *leaf == NULL) {
    close(parent);
    errno = EISDIR;
    return -1;
  }
  return parent;
}

static enum guest_filesystem_status perform_read(struct operation *asked, struct writer *into) {
  const char *leaf = NULL;
  int parent = open_leaf_parent(asked, &leaf);
  if (parent < 0) {
    return status_for(errno);
  }
  int file = openat(parent, leaf, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  int failure = errno;
  close(parent);
  if (file < 0) {
    return status_for(failure);
  }
  size_t room = into->capacity - into->length;
  size_t wanted = asked->length < room ? asked->length : room;
  /* Short of what was asked for means the end of the file, which is how the peer
   * learns where to stop rather than by being told a size that could already be
   * stale by the time it reads. */
  ssize_t seen = pread(file, into->bytes + into->length, wanted, (off_t)asked->offset);
  failure = errno;
  close(file);
  if (seen < 0) {
    return status_for(failure);
  }
  into->length += (size_t)seen;
  return GUEST_FILESYSTEM_OK;
}

/* Created on behalf of somebody browsing, by a process that is root: a file left
 * owned by root would be one the tenant's own binary cannot open, so ownership
 * follows the mount rather than the writer. */
static int open_for_write(int parent, const char *leaf) {
  int file =
      openat(parent, leaf, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, TENANT_FILE_MODE);
  if (file >= 0) {
    if (fchown(file, TENANT_UID, TENANT_GID) < 0) {
      log_errno("could not give a new file to the tenant");
    }
    return file;
  }
  if (errno != EEXIST) {
    return -1;
  }
  return openat(parent, leaf, O_WRONLY | O_NOFOLLOW | O_CLOEXEC);
}

static enum guest_filesystem_status perform_write(struct operation *asked, struct writer *into) {
  const char *leaf = NULL;
  int parent = open_leaf_parent(asked, &leaf);
  if (parent < 0) {
    return status_for(errno);
  }
  int file = open_for_write(parent, leaf);
  int failure = errno;
  close(parent);
  if (file < 0) {
    return status_for(failure);
  }
  ssize_t written = -1;
  if ((asked->flags & GUEST_FILESYSTEM_WRITE_TRUNCATE) == 0 ||
      ftruncate(file, (off_t)asked->offset) == 0) {
    written = pwrite(file, asked->content, asked->content_length, (off_t)asked->offset);
  }
  failure = errno;
  close(file);
  if (written < 0) {
    return status_for(failure);
  }
  if (!room_for(into, sizeof(uint32_t))) {
    return GUEST_FILESYSTEM_FAILED;
  }
  put_wide(into, (uint64_t)written, sizeof(uint32_t));
  return GUEST_FILESYSTEM_OK;
}

static enum guest_filesystem_status perform_make_directory(struct operation *asked) {
  const char *leaf = NULL;
  int parent = open_leaf_parent(asked, &leaf);
  if (parent < 0) {
    return status_for(errno);
  }
  enum guest_filesystem_status status = GUEST_FILESYSTEM_OK;
  if (mkdirat(parent, leaf, TENANT_DIRECTORY_MODE) < 0) {
    status = status_for(errno);
  } else if (fchownat(parent, leaf, TENANT_UID, TENANT_GID, AT_SYMLINK_NOFOLLOW) < 0) {
    log_errno("could not give a new directory to the tenant");
  }
  close(parent);
  return status;
}

/* One entry, never a tree: a recursive delete is a request whose cost the caller
 * cannot see before it is made, and a directory with anything in it says so instead. */
static enum guest_filesystem_status perform_remove(struct operation *asked) {
  const char *leaf = NULL;
  int parent = open_leaf_parent(asked, &leaf);
  if (parent < 0) {
    return status_for(errno);
  }
  if (unlinkat(parent, leaf, 0) == 0) {
    close(parent);
    return GUEST_FILESYSTEM_OK;
  }
  /* Unlinking a directory answers EISDIR on Linux and EPERM elsewhere. Neither is
   * the caller having asked for the wrong thing: a directory goes the same way,
   * behind the flag that says it is one. */
  enum guest_filesystem_status status = GUEST_FILESYSTEM_OK;
  if (errno != EISDIR && errno != EPERM) {
    status = status_for(errno);
  } else if (unlinkat(parent, leaf, AT_REMOVEDIR) < 0) {
    status = status_for(errno);
  }
  close(parent);
  return status;
}

static enum guest_filesystem_status perform_move(struct operation *asked) {
  const char *from_leaf = NULL;
  int from = open_leaf_parent(asked, &from_leaf);
  if (from < 0) {
    return status_for(errno);
  }
  const char *to_leaf = NULL;
  int to = open_parent(asked->mount_point, asked->destination, &to_leaf);
  if (to >= 0 && to_leaf == NULL) {
    close(to);
    errno = EISDIR;
    to = -1;
  }
  if (to < 0) {
    int failure = errno;
    close(from);
    return status_for(failure);
  }
  enum guest_filesystem_status status = GUEST_FILESYSTEM_OK;
  if (renameat(from, from_leaf, to, to_leaf) < 0) {
    status = status_for(errno);
  }
  close(from);
  close(to);
  return status;
}

static bool take_path(struct cursor *from, char *path, size_t capacity) {
  const unsigned char *bytes = NULL;
  uint32_t length = 0;
  return take_field(from, &bytes, &length) && copy_path(bytes, length, path, capacity);
}

/* The mount point rather than a path inside it, because there is no path inside it
 * that is on a different filesystem: the volume is the whole of what the tenant has.
 *
 * `f_frsize` is what block counts are in — `f_bsize` is the size a filesystem would
 * rather be asked for, and multiplying by it is how this reads plausibly wrong on a
 * filesystem where the two differ. */
static enum guest_filesystem_status perform_usage(const struct operation *asked,
                                                  struct writer *into) {
  struct statvfs measured;
  if (statvfs(asked->mount_point, &measured) < 0) {
    return status_for(errno);
  }
  if (!room_for(into, GUEST_FILESYSTEM_USAGE_BYTES)) {
    return GUEST_FILESYSTEM_FAILED;
  }
  uint64_t block = measured.f_frsize;
  put_wide(into, (uint64_t)measured.f_blocks * block, sizeof(uint64_t));
  put_wide(into, (uint64_t)(measured.f_blocks - measured.f_bfree) * block, sizeof(uint64_t));
  return GUEST_FILESYSTEM_OK;
}

static bool parse_operation(struct cursor *body, unsigned char verb, struct operation *asked) {
  if (verb != GUEST_FILESYSTEM_USAGE && !take_path(body, asked->path, sizeof(asked->path))) {
    return false;
  }
  switch (verb) {
    case GUEST_FILESYSTEM_READ:
      if (!take_offset(body, &asked->offset) || !take_u32(body, &asked->length)) {
        return false;
      }
      break;
    case GUEST_FILESYSTEM_WRITE:
      if (!take_offset(body, &asked->offset) || !take_u8(body, &asked->flags) ||
          !take_field(body, &asked->content, &asked->content_length)) {
        return false;
      }
      break;
    case GUEST_FILESYSTEM_MOVE:
      if (!take_path(body, asked->destination, sizeof(asked->destination))) {
        return false;
      }
      break;
    default:
      break;
  }
  /* Anything left over is a peer speaking a protocol this one does not, and reading
   * the part that happened to fit would be the wrong half of it. */
  return body->offset == body->length;
}

static enum guest_filesystem_status perform(unsigned char verb, struct operation *asked,
                                            struct writer *into) {
  switch (verb) {
    case GUEST_FILESYSTEM_LIST:
      return perform_list(asked, into);
    case GUEST_FILESYSTEM_STAT:
      return perform_stat(asked, into);
    case GUEST_FILESYSTEM_READ:
      return perform_read(asked, into);
    case GUEST_FILESYSTEM_WRITE:
      return perform_write(asked, into);
    case GUEST_FILESYSTEM_MAKE_DIRECTORY:
      return perform_make_directory(asked);
    case GUEST_FILESYSTEM_REMOVE:
      return perform_remove(asked);
    case GUEST_FILESYSTEM_MOVE:
      return perform_move(asked);
    case GUEST_FILESYSTEM_USAGE:
      return perform_usage(asked, into);
    default:
      return GUEST_FILESYSTEM_MALFORMED;
  }
}

static bool receive(int connection, unsigned char *bytes, size_t count, uint64_t deadline_ms) {
  size_t filled = 0;
  while (filled < count) {
    struct pollfd waiting = {.fd = connection, .events = POLLIN};
    int ready = poll(&waiting, 1, clock_remaining_ms(deadline_ms));
    if (ready < 0 && errno == EINTR) {
      continue;
    }
    if (ready <= 0) {
      return false;
    }
    ssize_t seen = recv(connection, bytes + filled, count - filled, 0);
    if (seen < 0 && errno == EINTR) {
      continue;
    }
    if (seen <= 0) {
      return false;
    }
    filled += (size_t)seen;
  }
  return true;
}

static bool send_all(int connection, const unsigned char *bytes, size_t count,
                     uint64_t deadline_ms) {
  size_t written = 0;
  while (written < count) {
    struct pollfd waiting = {.fd = connection, .events = POLLOUT};
    int ready = poll(&waiting, 1, clock_remaining_ms(deadline_ms));
    if (ready < 0 && errno == EINTR) {
      continue;
    }
    if (ready <= 0) {
      return false;
    }
    ssize_t sent = send(connection, bytes + written, count - written, MSG_NOSIGNAL);
    if (sent < 0 && errno == EINTR) {
      continue;
    }
    if (sent <= 0) {
      return false;
    }
    written += (size_t)sent;
  }
  return true;
}

static bool send_reply(int connection, enum guest_filesystem_status status,
                       const struct writer *body) {
  unsigned char header[GUEST_FILESYSTEM_HEADER_BYTES];
  struct writer into = {.bytes = header, .capacity = sizeof(header), .length = 0};
  put(&into, FRAME_MAGIC, sizeof(FRAME_MAGIC));
  put_u8(&into, (unsigned char)status);
  size_t length = status == GUEST_FILESYSTEM_OK ? body->length : 0;
  put_wide(&into, (uint64_t)length, sizeof(uint32_t));

  uint64_t deadline_ms = clock_monotonic_ms() + EXCHANGE_TIMEOUT_MS;
  return send_all(connection, header, sizeof(header), deadline_ms) &&
         (length == 0 || send_all(connection, body->bytes, length, deadline_ms));
}

enum exchange {
  /* The peer let go or stopped speaking, which this side cannot tell apart and has
   * no reason to. */
  EXCHANGE_ENDED,
  EXCHANGE_READ,
  /* Bytes that are not a frame. The stream is now at an offset nothing can recover. */
  EXCHANGE_UNFRAMED,
};

static enum exchange receive_request(int connection, unsigned char *into, unsigned char *verb,
                                     struct cursor *body) {
  unsigned char header[GUEST_FILESYSTEM_HEADER_BYTES];
  if (!receive(connection, header, sizeof(header), clock_monotonic_ms() + IDLE_TIMEOUT_MS)) {
    return EXCHANGE_ENDED;
  }
  if (memcmp(header, FRAME_MAGIC, sizeof(FRAME_MAGIC)) != 0) {
    return EXCHANGE_UNFRAMED;
  }
  uint32_t length = (uint32_t)decode(header + sizeof(FRAME_MAGIC) + 1, sizeof(uint32_t));
  if (length > GUEST_FILESYSTEM_BODY_MAX_BYTES) {
    return EXCHANGE_UNFRAMED;
  }
  if (length > 0 && !receive(connection, into, length, clock_monotonic_ms() + EXCHANGE_TIMEOUT_MS)) {
    return EXCHANGE_ENDED;
  }
  *verb = header[sizeof(FRAME_MAGIC)];
  *body = (struct cursor){.bytes = into, .length = length, .offset = 0};
  return EXCHANGE_READ;
}

void guest_filesystem_answer(const struct guest_filesystem_request *request) {
  struct exchange_buffers buffers;
  for (;;) {
    unsigned char verb = 0;
    struct cursor body = {.bytes = NULL, .length = 0, .offset = 0};
    enum exchange received =
        receive_request(request->connection, buffers.request, &verb, &body);
    if (received == EXCHANGE_ENDED) {
      return;
    }

    struct writer into = {
        .bytes = buffers.reply, .capacity = sizeof(buffers.reply), .length = 0};
    struct operation asked = {.mount_point = request->mount_point};
    enum guest_filesystem_status status = GUEST_FILESYSTEM_MALFORMED;
    if (received == EXCHANGE_READ && parse_operation(&body, verb, &asked)) {
      status = perform(verb, &asked, &into);
    }
    if (!send_reply(request->connection, status, &into)) {
      return;
    }
    /* A request that was merely refused leaves the stream where it was, so the peer
     * may ask again on the same connection. Bytes that were not a frame do not. */
    if (received == EXCHANGE_UNFRAMED) {
      return;
    }
  }
}

static int listen_on_filesystem_port(void) {
  int listener = socket(AF_VSOCK, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (listener < 0) {
    log_errno("could not open the filesystem socket");
    return -1;
  }
  struct vsock_address address = {
      .family = AF_VSOCK,
      .port = GUEST_FILESYSTEM_VSOCK_PORT,
      .cid = VMADDR_CID_ANY,
  };
  if (bind(listener, (const struct sockaddr *)&address, sizeof(address)) < 0) {
    log_errno("could not bind the filesystem socket");
    close(listener);
    return -1;
  }
  if (listen(listener, CONNECTION_BACKLOG) < 0) {
    log_errno("could not listen on the filesystem socket");
    close(listener);
    return -1;
  }
  return listener;
}

static void serve(const char *mount_point) {
  int listener = listen_on_filesystem_port();
  if (listener < 0) {
    return;
  }
  log_line("the filesystem channel is listening on vsock port %u", GUEST_FILESYSTEM_VSOCK_PORT);
  unsigned answering = 0;
  for (;;) {
    /* At the ceiling this waits for a worker to finish before taking the next
     * connection, and the listen backlog is what holds the rest. Refusing them
     * instead would make a burst of browsing look to the host like a guest that had
     * stopped answering. */
    while (answering >= MAX_CONCURRENT_ANSWERS) {
      if (waitpid(-1, NULL, 0) > 0) {
        answering--;
      } else if (errno != EINTR) {
        answering = 0;
      }
    }

    int connection = accept(listener, NULL, NULL);
    if (connection < 0) {
      if (errno == EINTR || errno == ECONNABORTED) {
        continue;
      }
      log_errno("could not accept a filesystem connection");
      break;
    }
    pid_t worker = fork();
    if (worker == 0) {
      close(listener);
      guest_filesystem_answer(
          &(struct guest_filesystem_request){.connection = connection, .mount_point = mount_point});
      _exit(0);
    }
    close(connection);
    if (worker < 0) {
      log_errno("could not answer a filesystem connection");
      continue;
    }
    answering++;
    while (waitpid(-1, NULL, WNOHANG) > 0) {
      answering--;
    }
  }
  close(listener);
}

void guest_filesystem_start(struct guest_filesystem *files) {
  pid_t process = fork();
  if (process < 0) {
    log_errno("could not start the filesystem channel");
    files->process = -1;
    return;
  }
  /* The acceptor and every worker it forks are one process group, so that stopping
   * the channel is one signal rather than a list of pids PID 1 would have to keep.
   * Set from both sides because either could run first, and setting it twice to the
   * same value is not an error. */
  if (process == 0) {
    setpgid(0, 0);
    serve(files->mount_point);
    _exit(0);
  }
  setpgid(process, process);
  files->process = process;
}

void guest_filesystem_stop(const struct guest_filesystem *files) {
  if (files->process <= 0) {
    return;
  }
  /* The whole group, because a worker still reading a tenant's file holds the mount
   * open and the unmount that follows this would find it busy.
   *
   * SIGKILL, not SIGTERM: PID 1 blocked the supervised signals before any of these
   * were forked, so they inherited a mask that would swallow anything catchable. A
   * worker that dies unreaped has already given the mount back — a zombie holds no
   * descriptors — so only the acceptor is waited for. */
  kill(-files->process, SIGKILL);
  while (waitpid(files->process, NULL, 0) < 0 && errno == EINTR) {
  }
}
