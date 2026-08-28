#ifndef NIBRUN_GUEST_FILESYSTEM_H
#define NIBRUN_GUEST_FILESYSTEM_H

#include <sys/types.h>

/* Answers the host's questions about the tenant's files from inside the guest, where
 * the filesystem is mounted, rather than leaving the host to read the block device
 * underneath. The host's view of that device is always behind — the guest holds the
 * same ext4 mounted read-write and its writes reach the blocks on a flush interval —
 * and it can never be written to at all, because the guest has it mounted. A readdir
 * in here is neither: it sees what the tenant just wrote, and a directory of a
 * thousand entries costs what one of nine costs.
 *
 * The wire format is below. The host agent's `lib/filesystem/protocol.ts` is the
 * other end of it. */

/* Every message is one frame: 'N' 'B' 'F' '1', one byte, a big-endian uint32 body
 * length, then the body. The byte is a verb going in and a status coming back.
 * Nothing in a body is text: a path and a filename are length-prefixed bytes,
 * because the tenant's own binary created these names and ext4 allows everything but
 * `/` and NUL in them — a space, a quote, a newline, a leading dash. */
#define GUEST_FILESYSTEM_FRAME_MAGIC "NBF1"
#define GUEST_FILESYSTEM_MAGIC_BYTES 4
#define GUEST_FILESYSTEM_HEADER_BYTES 9

/* The ceiling on both bodies, and the reason no request can make this side allocate.
 * It bounds a read to one chunk, a write to one chunk, and a listing to as many
 * entries as fit — which the reply says outright rather than pretending it was all
 * of them. */
#define GUEST_FILESYSTEM_BODY_MAX_BYTES 65536

enum guest_filesystem_verb {
  /* Body: path. Reply: one truncation byte, then an entry each. */
  GUEST_FILESYSTEM_LIST = 1,
  /* Body: path. Reply: one set of details. */
  GUEST_FILESYSTEM_STAT = 2,
  /* Body: path, uint64 offset, uint32 length. Reply: the bytes, short at end of file. */
  GUEST_FILESYSTEM_READ = 3,
  /* Body: path, uint64 offset, flag byte, content. Reply: uint32 bytes written. */
  GUEST_FILESYSTEM_WRITE = 4,
  /* Body: path. Reply: empty. Neither of these creates a parent it was not given. */
  GUEST_FILESYSTEM_MAKE_DIRECTORY = 5,
  /* Body: path. Reply: empty. A directory with anything in it is refused, not emptied. */
  GUEST_FILESYSTEM_REMOVE = 6,
  /* Body: path, path. Reply: empty. */
  GUEST_FILESYSTEM_MOVE = 7,
  /* Body: empty. Reply: uint64 total bytes, uint64 used bytes. The one verb that
   * names no path: a volume is one filesystem, so how full it is is not a question
   * about a place inside it. */
  GUEST_FILESYSTEM_USAGE = 8,
};

/* Truncates to the offset written at before writing, so that replacing a large file
 * with a small one does not leave the old tail behind it. Set on the first chunk of
 * an upload and on nothing else. */
#define GUEST_FILESYSTEM_WRITE_TRUNCATE 1U

enum guest_filesystem_status {
  GUEST_FILESYSTEM_OK = 0,
  GUEST_FILESYSTEM_NOT_FOUND = 1,
  /* A file where a directory was needed, or the other way round. */
  GUEST_FILESYSTEM_WRONG_KIND = 2,
  GUEST_FILESYSTEM_EXISTS = 3,
  GUEST_FILESYSTEM_NOT_EMPTY = 4,
  /* Includes every path that would leave the tenant's mount, by traversal or symlink. */
  GUEST_FILESYSTEM_DENIED = 5,
  GUEST_FILESYSTEM_MALFORMED = 6,
  GUEST_FILESYSTEM_FAILED = 7,
};

/* One entry is a kind byte, a uint64 size, a signed int64 mtime in seconds, then a
 * name of up to 255 bytes behind its own single-byte length. `stat` answers with the
 * first three and no name, because the caller already named what it asked about. */
#define GUEST_FILESYSTEM_DETAILS_BYTES 17

/* What `usage` answers with: the filesystem's size and what is spent of it, both
 * counted in the blocks the guest's own kernel counts. Used rather than free,
 * because free and available differ by the blocks ext4 reserves for root and the
 * tenant is not root — so the number that would be misread is the one left out. */
#define GUEST_FILESYSTEM_USAGE_BYTES 16

enum guest_filesystem_kind {
  GUEST_FILESYSTEM_FILE = 1,
  GUEST_FILESYSTEM_DIRECTORY = 2,
  /* Every symlink, socket, fifo and device node. A browser's only question is whether
   * descending is meaningful, and for all of these the answer is the same. */
  GUEST_FILESYSTEM_OTHER = 3,
};

struct guest_filesystem {
  pid_t process;
  const char *mount_point;
};

/* Serves in a child of PID 1, for the same reason the control channel does: the
 * supervisor's poll loop does not run while the tenant is between restarts, and
 * somebody browsing must not have to wait for a tenant to come back. Failing to
 * start is not fatal — the tenant runs regardless, and the host reports a read it
 * could not make.
 *
 * Unlike the control channel this holds nothing that outlives it, so it is left in
 * the OOM killer's reach: a lost listing is asked for again, and what a guest under
 * memory pressure should be reclaiming is the tenant's.
 *
 * The guest kernel is built without CONFIG_VSOCKETS_LOOPBACK, so the tenant cannot
 * reach this listener — the only peer a guest vsock port has is the host. */
void guest_filesystem_start(struct guest_filesystem *files);

void guest_filesystem_stop(const struct guest_filesystem *files);

struct guest_filesystem_request {
  int connection;
  /* Every path in the protocol is resolved from here and cannot leave it. */
  const char *mount_point;
};

/* Answers requests on one connection until the peer closes it, stops speaking, or
 * sends bytes that cannot be framed.
 *
 * Exposed rather than left private so a test can drive it over a socketpair, as the
 * control channel's lease loop is: a vsock and a unix socket are both SOCK_STREAM,
 * and a container has no Firecracker to carry the real thing. */
void guest_filesystem_answer(const struct guest_filesystem_request *request);

#endif
