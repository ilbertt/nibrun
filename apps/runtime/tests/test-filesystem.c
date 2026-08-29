/* The filesystem channel, driven over a socketpair standing in for the vsock a
 * container has no Firecracker to carry — the same substitution the control
 * channel's lease loop is tested through, and for the same reason. Both are
 * SOCK_STREAM, so the framing, the path resolution and the decision about when a
 * connection is over are the code the guest runs either way.
 *
 * The mount stood in for here is an ordinary directory: what these prove is how far
 * a path can reach and what survives the wire, neither of which is ext4's to decide. */

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#include "../src/guest-filesystem.h"
#include "expect.h"

#define BODY_BYTES 8192
#define MAX_ENTRIES 64
#define NAME_BYTES 256
#define REPLY_TIMEOUT_MS 5000
#define NOTHING_CAME_BACK 255
#define LONG_NAME_LENGTH 250
#define CROWDED_DIRECTORY_ENTRIES 300
#define LETTERS 26
#define FILE_MODE 0644
#define DIRECTORY_MODE 0755

struct session {
  int connection;
  pid_t server;
};

struct request {
  unsigned char body[BODY_BYTES];
  size_t length;
};

struct reply {
  unsigned char status;
  unsigned char body[GUEST_FILESYSTEM_BODY_MAX_BYTES];
  size_t length;
};

struct entry {
  unsigned char kind;
  uint64_t size;
  char name[NAME_BYTES];
};

static void add_bytes(struct request *into, const void *bytes, size_t count) {
  memcpy(into->body + into->length, bytes, count);
  into->length += count;
}

static void encode(unsigned char *bytes, uint64_t value, size_t count) {
  for (size_t index = 0; index < count; index++) {
    bytes[index] = (unsigned char)(value >> (CHAR_BIT * (count - index - 1)));
  }
}

static void add_wide(struct request *into, uint64_t value, size_t count) {
  encode(into->body + into->length, value, count);
  into->length += count;
}

static void add_field(struct request *into, const void *bytes, size_t count) {
  add_wide(into, count, sizeof(uint32_t));
  add_bytes(into, bytes, count);
}

static struct request asking_about(const char *path) {
  struct request asked = {.body = {0}, .length = 0};
  add_field(&asked, path, strlen(path));
  return asked;
}

static uint64_t decode(const unsigned char *bytes, size_t count) {
  uint64_t value = 0;
  for (size_t index = 0; index < count; index++) {
    value = (value << CHAR_BIT) | bytes[index];
  }
  return value;
}

static void frame_header(unsigned char *header, unsigned char code, size_t length) {
  memcpy(header, GUEST_FILESYSTEM_FRAME_MAGIC, GUEST_FILESYSTEM_MAGIC_BYTES);
  header[GUEST_FILESYSTEM_MAGIC_BYTES] = code;
  encode(header + GUEST_FILESYSTEM_MAGIC_BYTES + 1, length, sizeof(uint32_t));
}

static bool write_all(int connection, const void *bytes, size_t count) {
  const unsigned char *cursor = bytes;
  size_t written = 0;
  while (written < count) {
    ssize_t sent = write(connection, cursor + written, count - written);
    if (sent <= 0) {
      return false;
    }
    written += (size_t)sent;
  }
  return true;
}

static bool read_all(int connection, void *bytes, size_t count) {
  unsigned char *cursor = bytes;
  size_t filled = 0;
  while (filled < count) {
    struct pollfd waiting = {.fd = connection, .events = POLLIN, .revents = 0};
    if (poll(&waiting, 1, REPLY_TIMEOUT_MS) <= 0) {
      return false;
    }
    ssize_t seen = read(connection, cursor + filled, count - filled);
    if (seen <= 0) {
      return false;
    }
    filled += (size_t)seen;
  }
  return true;
}

static bool ask(const struct session *session, unsigned char verb, const struct request *asked) {
  unsigned char header[GUEST_FILESYSTEM_HEADER_BYTES];
  frame_header(header, verb, asked->length);
  return write_all(session->connection, header, sizeof(header)) &&
         (asked->length == 0 || write_all(session->connection, asked->body, asked->length));
}

static bool hear(const struct session *session, struct reply *heard) {
  unsigned char header[GUEST_FILESYSTEM_HEADER_BYTES];
  if (!read_all(session->connection, header, sizeof(header)) ||
      memcmp(header, GUEST_FILESYSTEM_FRAME_MAGIC, GUEST_FILESYSTEM_MAGIC_BYTES) != 0) {
    return false;
  }
  heard->status = header[GUEST_FILESYSTEM_MAGIC_BYTES];
  heard->length = (size_t)decode(header + GUEST_FILESYSTEM_MAGIC_BYTES + 1, sizeof(uint32_t));
  return heard->length <= sizeof(heard->body) &&
         (heard->length == 0 || read_all(session->connection, heard->body, heard->length));
}

static unsigned char exchange(const struct session *session, unsigned char verb,
                              const struct request *asked, struct reply *heard) {
  heard->status = NOTHING_CAME_BACK;
  heard->length = 0;
  return ask(session, verb, asked) && hear(session, heard) ? heard->status : NOTHING_CAME_BACK;
}

static unsigned char answering(const struct session *session, unsigned char verb,
                               const char *path) {
  struct reply heard;
  const struct request asked = asking_about(path);
  return exchange(session, verb, &asked, &heard);
}

static struct session open_session(const char *mount_point) {
  int pair[2];
  if (socketpair(AF_UNIX, SOCK_STREAM, 0, pair) < 0) {
    return (struct session){.connection = -1, .server = -1};
  }
  pid_t server = fork();
  if (server == 0) {
    close(pair[0]);
    guest_filesystem_answer(
        &(struct guest_filesystem_request){.connection = pair[1], .mount_point = mount_point});
    _exit(0);
  }
  close(pair[1]);
  return (struct session){.connection = pair[0], .server = server};
}

/* The server ending once its peer is gone is half of every case here: a worker that
 * outlived its connection would be a process the guest never gets back. */
static bool close_session(const struct session *session) {
  close(session->connection);
  int status = 0;
  while (waitpid(session->server, &status, 0) < 0 && errno == EINTR) {
  }
  return WIFEXITED(status) && WEXITSTATUS(status) == 0;
}

static size_t entries_of(const struct reply *heard, struct entry *entries, bool *truncated) {
  if (heard->length == 0) {
    return 0;
  }
  *truncated = heard->body[0] != 0;
  size_t offset = 1;
  size_t count = 0;
  while (count < MAX_ENTRIES && offset + GUEST_FILESYSTEM_DETAILS_BYTES < heard->length) {
    size_t name_length = heard->body[offset + GUEST_FILESYSTEM_DETAILS_BYTES];
    if (name_length == 0 || name_length >= NAME_BYTES ||
        offset + GUEST_FILESYSTEM_DETAILS_BYTES + 1 + name_length > heard->length) {
      break;
    }
    entries[count].kind = heard->body[offset];
    entries[count].size = decode(heard->body + offset + 1, sizeof(uint64_t));
    memcpy(entries[count].name, heard->body + offset + GUEST_FILESYSTEM_DETAILS_BYTES + 1,
           name_length);
    entries[count].name[name_length] = '\0';
    offset += GUEST_FILESYSTEM_DETAILS_BYTES + 1 + name_length;
    count++;
  }
  return count;
}

static const struct entry *named(const struct entry *entries, size_t count, const char *name) {
  for (size_t index = 0; index < count; index++) {
    if (strcmp(entries[index].name, name) == 0) {
      return &entries[index];
    }
  }
  return NULL;
}

static bool create_file(int directory, const char *name, const void *bytes, size_t length) {
  int file = openat(directory, name, O_WRONLY | O_CREAT | O_TRUNC, FILE_MODE);
  if (file < 0) {
    return false;
  }
  bool written = write(file, bytes, length) == (ssize_t)length;
  close(file);
  return written;
}

static size_t listing_of(const struct session *session, const char *path, struct entry *entries,
                         bool *truncated) {
  struct reply heard;
  const struct request asked = asking_about(path);
  EXPECT(exchange(session, GUEST_FILESYSTEM_LIST, &asked, &heard) == GUEST_FILESYSTEM_OK);
  return entries_of(&heard, entries, truncated);
}

/* Anything ext4 allows in a name, which is anything but `/` and NUL. The tenant's own
 * binary created these, so a browser that cannot describe one is a browser hiding a
 * file from the person who owns it. */
static const char *const AWKWARD_NAMES[] = {
    "my report v2.txt", "it's \"quoted\"", "two\nlines", "-rf", "donn\xc3\xa9" "es.txt",
};

static const size_t AWKWARD_NAME_COUNT = sizeof(AWKWARD_NAMES) / sizeof(AWKWARD_NAMES[0]);

static void every_awkward_name_survives_a_listing(const char *mount_point, int root) {
  for (size_t index = 0; index < AWKWARD_NAME_COUNT; index++) {
    EXPECT(create_file(root, AWKWARD_NAMES[index], "x", 1));
  }

  struct session session = open_session(mount_point);
  struct entry entries[MAX_ENTRIES];
  bool truncated = true;
  size_t count = listing_of(&session, "/", entries, &truncated);

  EXPECT(!truncated);
  for (size_t index = 0; index < AWKWARD_NAME_COUNT; index++) {
    const struct entry *entry = named(entries, count, AWKWARD_NAMES[index]);
    EXPECT(entry != NULL && entry->kind == GUEST_FILESYSTEM_FILE && entry->size == 1);
  }
  /* The filesystem's own bookkeeping, which the wire never carries. */
  EXPECT(named(entries, count, ".") == NULL);
  EXPECT(named(entries, count, "..") == NULL);
  EXPECT(close_session(&session));
}

static void nothing_reaches_outside_the_mount(const char *mount_point, int root) {
  EXPECT(mkdirat(root, "inner", DIRECTORY_MODE) == 0);
  EXPECT(symlinkat("/etc", root, "escape") == 0);

  struct session session = open_session(mount_point);
  /* `..` is refused rather than resolved, at any depth and whichever verb asks. */
  EXPECT(answering(&session, GUEST_FILESYSTEM_LIST, "/..") == GUEST_FILESYSTEM_DENIED);
  EXPECT(answering(&session, GUEST_FILESYSTEM_LIST, "/inner/../..") == GUEST_FILESYSTEM_DENIED);
  EXPECT(answering(&session, GUEST_FILESYSTEM_LIST, "/./inner") == GUEST_FILESYSTEM_DENIED);
  EXPECT(answering(&session, GUEST_FILESYSTEM_STAT, "/../etc/passwd") == GUEST_FILESYSTEM_DENIED);
  EXPECT(answering(&session, GUEST_FILESYSTEM_REMOVE, "/../inner") == GUEST_FILESYSTEM_DENIED);
  /* A symlink out is a door the tenant built, and it is not walked through: it is
   * described in a listing and refused as a path, at the leaf and in the middle. */
  EXPECT(answering(&session, GUEST_FILESYSTEM_LIST, "/escape") == GUEST_FILESYSTEM_DENIED);
  EXPECT(answering(&session, GUEST_FILESYSTEM_STAT, "/escape/passwd") == GUEST_FILESYSTEM_DENIED);
  /* A path that is not absolute names nothing at all. */
  EXPECT(answering(&session, GUEST_FILESYSTEM_LIST, "inner") == GUEST_FILESYSTEM_MALFORMED);

  struct entry entries[MAX_ENTRIES];
  bool truncated = false;
  size_t count = listing_of(&session, "/", entries, &truncated);
  const struct entry *link = named(entries, count, "escape");
  EXPECT(link != NULL && link->kind == GUEST_FILESYSTEM_OTHER);
  EXPECT(close_session(&session));
}

/* Byte for byte, NULs and newlines included: what a tenant's binary wrote is not text
 * and never was. */
static const unsigned char BINARY[] = {0x00, 'a', 0x0a, 0xff, '"', 0x00, 0x7f, '\\'};
#define SHORTENED_BYTES 2

static struct request writing(const char *path, const unsigned char *bytes, size_t length) {
  struct request written = asking_about(path);
  add_wide(&written, 0, sizeof(uint64_t));
  add_wide(&written, GUEST_FILESYSTEM_WRITE_TRUNCATE, 1);
  add_field(&written, bytes, length);
  return written;
}

static void a_file_round_trips_its_bytes(const char *mount_point) {
  struct session session = open_session(mount_point);
  struct reply heard;

  const struct request written = writing("/blob", BINARY, sizeof(BINARY));
  EXPECT(exchange(&session, GUEST_FILESYSTEM_WRITE, &written, &heard) == GUEST_FILESYSTEM_OK);
  EXPECT(decode(heard.body, sizeof(uint32_t)) == sizeof(BINARY));

  struct request read = asking_about("/blob");
  add_wide(&read, 0, sizeof(uint64_t));
  add_wide(&read, sizeof(BINARY) * 2, sizeof(uint32_t));
  EXPECT(exchange(&session, GUEST_FILESYSTEM_READ, &read, &heard) == GUEST_FILESYSTEM_OK);
  EXPECT(heard.length == sizeof(BINARY) && memcmp(heard.body, BINARY, sizeof(BINARY)) == 0);

  /* Replacing a long file with a short one leaves none of the old one behind it. */
  const struct request replaced = writing("/blob", BINARY, SHORTENED_BYTES);
  EXPECT(exchange(&session, GUEST_FILESYSTEM_WRITE, &replaced, &heard) == GUEST_FILESYSTEM_OK);
  EXPECT(exchange(&session, GUEST_FILESYSTEM_READ, &read, &heard) == GUEST_FILESYSTEM_OK);
  EXPECT(heard.length == SHORTENED_BYTES);

  EXPECT(answering(&session, GUEST_FILESYSTEM_STAT, "/blob") == GUEST_FILESYSTEM_OK);
  EXPECT(answering(&session, GUEST_FILESYSTEM_STAT, "/never-written") == GUEST_FILESYSTEM_NOT_FOUND);
  EXPECT(close_session(&session));
}

static void a_tree_is_made_moved_and_taken_apart(const char *mount_point) {
  struct session session = open_session(mount_point);
  struct reply heard;

  EXPECT(answering(&session, GUEST_FILESYSTEM_MAKE_DIRECTORY, "/made") == GUEST_FILESYSTEM_OK);
  EXPECT(answering(&session, GUEST_FILESYSTEM_MAKE_DIRECTORY, "/made") == GUEST_FILESYSTEM_EXISTS);
  /* Neither verb creates a parent it was not given. */
  EXPECT(answering(&session, GUEST_FILESYSTEM_MAKE_DIRECTORY, "/absent/deep") ==
         GUEST_FILESYSTEM_NOT_FOUND);

  const struct request written = writing("/made/first", BINARY, sizeof(BINARY));
  EXPECT(exchange(&session, GUEST_FILESYSTEM_WRITE, &written, &heard) == GUEST_FILESYSTEM_OK);

  struct request moved = asking_about("/made/first");
  add_field(&moved, "/made/second", strlen("/made/second"));
  EXPECT(exchange(&session, GUEST_FILESYSTEM_MOVE, &moved, &heard) == GUEST_FILESYSTEM_OK);
  EXPECT(answering(&session, GUEST_FILESYSTEM_STAT, "/made/first") == GUEST_FILESYSTEM_NOT_FOUND);
  EXPECT(answering(&session, GUEST_FILESYSTEM_STAT, "/made/second") == GUEST_FILESYSTEM_OK);

  /* One entry, never a tree: a directory with anything in it says so rather than
   * being emptied by a request whose cost nobody could see before making it. */
  EXPECT(answering(&session, GUEST_FILESYSTEM_REMOVE, "/made") == GUEST_FILESYSTEM_NOT_EMPTY);
  EXPECT(answering(&session, GUEST_FILESYSTEM_REMOVE, "/made/second") == GUEST_FILESYSTEM_OK);
  EXPECT(answering(&session, GUEST_FILESYSTEM_REMOVE, "/made") == GUEST_FILESYSTEM_OK);
  EXPECT(answering(&session, GUEST_FILESYSTEM_REMOVE, "/made") == GUEST_FILESYSTEM_NOT_FOUND);
  /* The mount itself is not something any of them acts on. */
  EXPECT(answering(&session, GUEST_FILESYSTEM_REMOVE, "/") == GUEST_FILESYSTEM_WRONG_KIND);
  EXPECT(close_session(&session));
}

static void a_listing_says_when_it_did_not_fit(const char *mount_point, int root) {
  EXPECT(mkdirat(root, "crowded", DIRECTORY_MODE) == 0);
  int crowded = openat(root, "crowded", O_RDONLY | O_DIRECTORY);
  EXPECT(crowded >= 0);
  char name[NAME_BYTES];
  memset(name, 'n', LONG_NAME_LENGTH);
  name[LONG_NAME_LENGTH] = '\0';
  for (size_t index = 0; index < CROWDED_DIRECTORY_ENTRIES; index++) {
    name[0] = (char)('a' + index % LETTERS);
    name[1] = (char)('a' + (index / LETTERS) % LETTERS);
    EXPECT(create_file(crowded, name, "x", 1));
  }
  close(crowded);

  struct session session = open_session(mount_point);
  struct entry entries[MAX_ENTRIES];
  bool truncated = false;
  listing_of(&session, "/crowded", entries, &truncated);

  /* Said outright rather than answered as if it were all of them: a directory too
   * large for one frame is the one case where a listing that looks complete lies. */
  EXPECT(truncated);
  EXPECT(close_session(&session));
}

/* Bytes that are not a frame end the connection, because the stream is then at an
 * offset nothing can recover. A request that merely did not parse does not: the peer
 * is still speaking the protocol and may ask again on the same connection. */
static void a_request_this_side_cannot_read_costs_only_itself(const char *mount_point) {
  struct reply heard;
  unsigned char header[GUEST_FILESYSTEM_HEADER_BYTES];

  struct session unframed = open_session(mount_point);
  frame_header(header, GUEST_FILESYSTEM_LIST, 0);
  header[0] = 'X';
  EXPECT(write_all(unframed.connection, header, sizeof(header)));
  EXPECT(hear(&unframed, &heard) && heard.status == GUEST_FILESYSTEM_MALFORMED);
  EXPECT(close_session(&unframed));

  struct session oversized = open_session(mount_point);
  frame_header(header, GUEST_FILESYSTEM_LIST, UINT32_MAX);
  EXPECT(write_all(oversized.connection, header, sizeof(header)));
  EXPECT(hear(&oversized, &heard) && heard.status == GUEST_FILESYSTEM_MALFORMED);
  EXPECT(close_session(&oversized));

  struct session session = open_session(mount_point);
  const struct request empty = {.body = {0}, .length = 0};
  EXPECT(exchange(&session, GUEST_FILESYSTEM_LIST, &empty, &heard) == GUEST_FILESYSTEM_MALFORMED);
  struct request trailing = asking_about("/");
  add_wide(&trailing, 0, sizeof(uint64_t));
  EXPECT(exchange(&session, GUEST_FILESYSTEM_LIST, &trailing, &heard) == GUEST_FILESYSTEM_MALFORMED);
  EXPECT(answering(&session, GUEST_FILESYSTEM_MOVE, "/blob") == GUEST_FILESYSTEM_MALFORMED);
  EXPECT(answering(&session, UCHAR_MAX, "/") == GUEST_FILESYSTEM_MALFORMED);
  EXPECT(answering(&session, GUEST_FILESYSTEM_LIST, "/") == GUEST_FILESYSTEM_OK);
  EXPECT(close_session(&session));
}

/* A peer that stops half way through is the ordinary end of a connection somebody
 * navigated away from rather than a case worth an error: the worker ends with it. */
static void a_peer_that_leaves_mid_request_ends_the_worker(const char *mount_point) {
  struct session halted = open_session(mount_point);
  unsigned char header[GUEST_FILESYSTEM_HEADER_BYTES];
  frame_header(header, GUEST_FILESYSTEM_LIST, 0);
  EXPECT(write_all(halted.connection, header, GUEST_FILESYSTEM_MAGIC_BYTES));
  EXPECT(close_session(&halted));

  struct session starved = open_session(mount_point);
  const struct request asked = asking_about("/");
  frame_header(header, GUEST_FILESYSTEM_LIST, asked.length * 2);
  EXPECT(write_all(starved.connection, header, sizeof(header)));
  EXPECT(write_all(starved.connection, asked.body, asked.length));
  EXPECT(close_session(&starved));
}

/* How full the filesystem is, which is a question about the mount and not about a
 * place inside it — so the one verb whose body is empty, and the one whose answer
 * this test can only bound: the directory stands in for a real mount, and what is on
 * the container's disk is not this file's to know. */
static void how_full_the_volume_is_is_measured_without_naming_a_path(const char *mount_point) {
  struct session session = open_session(mount_point);
  struct reply heard;
  const struct request nothing = {.body = {0}, .length = 0};

  EXPECT(exchange(&session, GUEST_FILESYSTEM_USAGE, &nothing, &heard) == GUEST_FILESYSTEM_OK);
  EXPECT(heard.length == GUEST_FILESYSTEM_USAGE_BYTES);

  uint64_t total = decode(heard.body, sizeof(uint64_t));
  uint64_t used = decode(heard.body + sizeof(uint64_t), sizeof(uint64_t));
  EXPECT(total > 0);
  EXPECT(used <= total);

  /* A path is not merely ignored: sending one is a peer speaking a protocol this one
   * does not, and reading the part that happened to fit would be the wrong half. */
  EXPECT(answering(&session, GUEST_FILESYSTEM_USAGE, "/") == GUEST_FILESYSTEM_MALFORMED);
  EXPECT(answering(&session, GUEST_FILESYSTEM_LIST, "/") == GUEST_FILESYSTEM_OK);
  EXPECT(close_session(&session));
}

/* Reads the real /proc of whatever is running this, which is the point: the parsing
 * is the part that can be wrong, and a fixture of made-up lines would only prove that
 * this side can read lines it wrote itself. What is asserted is what holds of every
 * running Linux rather than of this one — the numbers themselves belong to the host
 * the suite happens to be on. */
static void what_the_machine_is_spending_is_measured_without_naming_a_path(const char *mount_point) {
  struct session session = open_session(mount_point);
  struct reply heard;
  const struct request nothing = {.body = {0}, .length = 0};

  EXPECT(exchange(&session, GUEST_FILESYSTEM_COMPUTE, &nothing, &heard) == GUEST_FILESYSTEM_OK);
  EXPECT(heard.length == GUEST_FILESYSTEM_COMPUTE_BYTES);

  uint64_t memory_total = decode(heard.body, sizeof(uint64_t));
  uint64_t memory_used = decode(heard.body + sizeof(uint64_t), sizeof(uint64_t));
  uint64_t cpu_total = decode(heard.body + (2 * sizeof(uint64_t)), sizeof(uint64_t));
  uint64_t cpu_busy = decode(heard.body + (3 * sizeof(uint64_t)), sizeof(uint64_t));
  EXPECT(memory_total > 0);
  EXPECT(memory_used <= memory_total);
  EXPECT(cpu_total > 0);
  EXPECT(cpu_busy <= cpu_total);

  /* Cumulative rather than a level, which is the whole reason the host keeps two of
   * them: a second reading can equal the first on an idle guest, and can never be
   * behind it. */
  struct reply again;
  EXPECT(exchange(&session, GUEST_FILESYSTEM_COMPUTE, &nothing, &again) == GUEST_FILESYSTEM_OK);
  EXPECT(decode(again.body + (2 * sizeof(uint64_t)), sizeof(uint64_t)) >= cpu_total);

  EXPECT(answering(&session, GUEST_FILESYSTEM_COMPUTE, "/") == GUEST_FILESYSTEM_MALFORMED);
  EXPECT(answering(&session, GUEST_FILESYSTEM_LIST, "/") == GUEST_FILESYSTEM_OK);
  EXPECT(close_session(&session));
}

int main(void) {
  char mount_point[] = "/tmp/nibrun-filesystem-XXXXXX";
  if (mkdtemp(mount_point) == NULL) {
    fprintf(stderr, "could not make a directory to stand in for the mount\n");
    return 64;
  }
  int root = open(mount_point, O_RDONLY | O_DIRECTORY);
  if (root < 0) {
    fprintf(stderr, "could not open the directory standing in for the mount\n");
    return 64;
  }
  /* Otherwise this process ends the moment a worker hangs up before it is read. */
  signal(SIGPIPE, SIG_IGN);

  every_awkward_name_survives_a_listing(mount_point, root);
  nothing_reaches_outside_the_mount(mount_point, root);
  a_file_round_trips_its_bytes(mount_point);
  a_tree_is_made_moved_and_taken_apart(mount_point);
  a_listing_says_when_it_did_not_fit(mount_point, root);
  a_request_this_side_cannot_read_costs_only_itself(mount_point);
  a_peer_that_leaves_mid_request_ends_the_worker(mount_point);
  how_full_the_volume_is_is_measured_without_naming_a_path(mount_point);
  what_the_machine_is_spending_is_measured_without_naming_a_path(mount_point);

  close(root);
  return EXPECT_REPORT("filesystem");
}
