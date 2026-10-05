#include "guest-sqlite.h"
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <poll.h>
#include <signal.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>
#include "clock.h"
#include "log.h"
#include "paths.h"
#include "sqlite-query.h"
#include "vsock.h"

#define SQLITE_MAX_WORKERS 4
#define SQLITE_SESSION_IDLE_MS 30000
static volatile sig_atomic_t stopping;

static void stop_requested(int signal_number) {
  (void)signal_number;
  stopping = 1;
}

static bool prepare_signals(void) {
  stopping = 0;
  struct sigaction action = {.sa_handler = stop_requested};
  sigemptyset(&action.sa_mask);
  sigset_t unblocked;
  sigemptyset(&unblocked);
  sigaddset(&unblocked, SIGTERM);
  return sigaction(SIGTERM, &action, NULL) == 0 && sigprocmask(SIG_UNBLOCK, &unblocked, NULL) == 0;
}

static bool transfer(int connection, unsigned char *bytes, size_t length, bool sending,
                     uint32_t timeout_ms) {
  uint64_t deadline = clock_monotonic_ms() + timeout_ms;
  size_t position = 0;
  while (!stopping && position < length) {
    int remaining = clock_remaining_ms(deadline);
    if (remaining == 0)
      return false;
    struct pollfd peer = {.fd = connection, .events = sending ? POLLOUT : POLLIN};
    int ready = poll(&peer, 1, remaining);
    if (ready < 0 && errno == EINTR)
      continue;
    if (ready <= 0)
      return false;
    ssize_t count =
        sending ? send(connection, bytes + position, length - position, MSG_NOSIGNAL | MSG_DONTWAIT)
                : recv(connection, bytes + position, length - position, MSG_DONTWAIT);
    if (count < 0 && (errno == EINTR || errno == EAGAIN))
      continue;
    if (count <= 0)
      return false;
    position += (size_t)count;
  }
  return !stopping;
}

static bool send_reply(const struct guest_sqlite_request *request, unsigned char code,
                       struct sqlite_wire *reply) {
  unsigned char header[SQLITE_WIRE_HEADER_BYTES];
  memcpy(header, SQLITE_WIRE_MAGIC, 4);
  header[4] = code;
  struct sqlite_wire length = {.bytes = header + 5, .length = 4};
  sqlite_wire_write_integer(&length, reply->position, 4);
  return transfer(request->connection, header, sizeof(header), true, request->timeout_ms) &&
         transfer(request->connection, reply->bytes, reply->position, true, request->timeout_ms);
}

static bool jail_worker(const char *mount_point) {
  const struct rlimit memory = {.rlim_cur = 128 * 1024 * 1024, .rlim_max = 128 * 1024 * 1024};
  const struct rlimit files = {.rlim_cur = 64, .rlim_max = 64};
  int oom = open("/proc/self/oom_score_adj", O_WRONLY | O_CLOEXEC);
  if (oom >= 0) {
    ssize_t count = write(oom, "500", 3);
    (void)count;
    close(oom);
  }
  return setrlimit(RLIMIT_AS, &memory) == 0 && setrlimit(RLIMIT_NOFILE, &files) == 0 &&
         chdir(mount_point) == 0 && chroot(".") == 0 && chdir("/") == 0 &&
         setgroups(0, NULL) == 0 && setgid(TENANT_GID) == 0 && setuid(TENANT_UID) == 0;
}

void guest_sqlite_answer(const struct guest_sqlite_request *request) {
  if (!prepare_signals())
    return;
  unsigned char input[SQLITE_WIRE_MAX_BYTES + 1];
  unsigned char output[SQLITE_WIRE_MAX_BYTES];
  struct sqlite_query query = {.connection = request->connection, .stopping = &stopping};
  bool jailed = jail_worker(request->mount_point);
  for (;;) {
    unsigned char header[SQLITE_WIRE_HEADER_BYTES];
    if (!transfer(request->connection, header, sizeof(header), false, request->timeout_ms) ||
        memcmp(header, SQLITE_WIRE_MAGIC, 4) != 0)
      break;
    struct sqlite_wire encoded_length = {.bytes = header + 5, .length = 4};
    size_t size = (size_t)sqlite_wire_integer(&encoded_length, 4);
    if (size > SQLITE_WIRE_MAX_BYTES ||
        !transfer(request->connection, input, size, false, SQLITE_QUERY_TIMEOUT_MS))
      break;
    input[size] = '\0';
    struct sqlite_wire incoming = {.bytes = input, .length = size};
    struct sqlite_wire reply = {.bytes = output, .length = sizeof(output)};
    unsigned char operation = header[4];
    unsigned char code = SQLITE_WIRE_OK;
    if (!jailed) {
      sqlite_query_error(&query, SQLITE_CANTOPEN, &reply);
      code = SQLITE_WIRE_ERROR;
    } else if (operation == SQLITE_WIRE_OPEN && query.database == NULL) {
      int opened = memchr(input, 0, size) == NULL ? sqlite_query_open(&query, (const char *)input)
                                                  : SQLITE_CANTOPEN;
      if (opened != SQLITE_OK) {
        sqlite_query_error(&query, opened, &reply);
        code = SQLITE_WIRE_ERROR;
      }
    } else if (operation == SQLITE_WIRE_CLOSE && size == 0) {
      send_reply(request, code, &reply);
      break;
    } else if (query.database != NULL && operation != SQLITE_WIRE_OPEN) {
      code = sqlite_query_run(&query, operation, &incoming, &reply);
    } else {
      sqlite_query_error(&query, SQLITE_MISUSE, &reply);
      code = SQLITE_WIRE_ERROR;
    }
    if (!send_reply(request, code, &reply) || !jailed ||
        (operation == SQLITE_WIRE_OPEN && code == SQLITE_WIRE_ERROR))
      break;
  }
  if (query.database != NULL)
    sqlite3_close(query.database);
}

void guest_sqlite_refuse(int connection) {
  unsigned char output[64];
  struct sqlite_wire reply = {.bytes = output, .length = sizeof(output)};
  struct sqlite_query query = {0};
  sqlite_query_error(&query, SQLITE_BUSY, &reply);
  const struct guest_sqlite_request request = {.connection = connection, .timeout_ms = 250};
  send_reply(&request, SQLITE_WIRE_ERROR, &reply);
}
