#include "guest-control.h"

#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>

#include "clock.h"
#include "log.h"
#include "vsock.h"

/* _IOWR('X', 119, int) and its pair, spelled out for the same reason the vsock
 * address is: the musl toolchain carries no linux/fs.h. */
#define FIFREEZE _IOWR('X', 119, int)
#define FITHAW _IOWR('X', 120, int)

/* One export at a time. A second one waits here rather than meeting an EBUSY from a
 * filesystem the first has already frozen. */
#define CONNECTION_BACKLOG 1
#define REQUEST_MAX_BYTES 32
#define REQUEST_TIMEOUT_MS 5000

/* A frozen filesystem is a tenant whose writes are blocked, and the host holds the
 * freeze for as long as it takes to read the whole device. This is the ceiling on
 * that: past it the guest thaws and drops the connection, which is how the host
 * learns the bundle it just built cannot be trusted. */
#define MAX_FREEZE_HOLD_MS 900000U

static const char FREEZE_REQUEST[] = "FREEZE\n";
static const char FREEZE_HELD[] = "OK\n";
static const char FREEZE_REFUSED[] = "ERR the data filesystem could not be frozen\n";
static const char UNKNOWN_REQUEST[] = "ERR unknown request\n";

bool guest_control_freeze(const char *mount_point) {
  int mount_descriptor = open(mount_point, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (mount_descriptor < 0) {
    return false;
  }
  bool frozen = ioctl(mount_descriptor, FIFREEZE, 0) == 0;
  int failure = errno;
  close(mount_descriptor);
  errno = failure;
  return frozen;
}

bool guest_control_thaw(const char *mount_point) {
  int mount_descriptor = open(mount_point, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (mount_descriptor < 0) {
    return false;
  }
  bool thawed = ioctl(mount_descriptor, FITHAW, 0) == 0;
  int failure = errno;
  close(mount_descriptor);
  errno = failure;
  return thawed;
}

static int listen_on_control_port(void) {
  int listener = socket(AF_VSOCK, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (listener < 0) {
    log_errno("could not open the control socket");
    return -1;
  }
  struct vsock_address address = {
      .family = AF_VSOCK,
      .port = GUEST_CONTROL_VSOCK_PORT,
      .cid = VMADDR_CID_ANY,
  };
  if (bind(listener, (const struct sockaddr *)&address, sizeof(address)) < 0) {
    log_errno("could not bind the control socket");
    close(listener);
    return -1;
  }
  if (listen(listener, CONNECTION_BACKLOG) < 0) {
    log_errno("could not listen on the control socket");
    close(listener);
    return -1;
  }
  return listener;
}

static bool reply(int connection, const char *line) {
  size_t length = strlen(line);
  size_t written = 0;
  while (written < length) {
    ssize_t sent = send(connection, line + written, length - written, MSG_NOSIGNAL);
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

/* One byte at a time, which for a seven-byte request costs less than the state a
 * buffered reader would need to carry between connections. */
static bool read_request(int connection, char *buffer, size_t capacity) {
  size_t filled = 0;
  while (filled + 1 < capacity) {
    struct pollfd waiting = {.fd = connection, .events = POLLIN};
    int ready = poll(&waiting, 1, REQUEST_TIMEOUT_MS);
    if (ready < 0 && errno == EINTR) {
      continue;
    }
    if (ready <= 0) {
      return false;
    }
    ssize_t seen = recv(connection, buffer + filled, 1, 0);
    if (seen < 0 && errno == EINTR) {
      continue;
    }
    if (seen <= 0) {
      return false;
    }
    filled += (size_t)seen;
    if (buffer[filled - 1] == '\n') {
      buffer[filled] = '\0';
      return true;
    }
  }
  return false;
}

/* The connection is the lease. A host that finishes, crashes or is killed drops it,
 * and the filesystem thaws without anybody having to ask — which is what keeps a
 * dead agent from leaving a tenant wedged. The deadline covers the host that
 * neither finishes nor lets go. */
static bool wait_until_released(int connection) {
  uint64_t deadline_ms = clock_monotonic_ms() + MAX_FREEZE_HOLD_MS;
  for (;;) {
    struct pollfd waiting = {.fd = connection, .events = POLLIN};
    int ready = poll(&waiting, 1, clock_remaining_ms(deadline_ms));
    if (ready < 0 && errno == EINTR) {
      continue;
    }
    if (ready <= 0) {
      return false;
    }
    char unexpected;
    ssize_t seen = recv(connection, &unexpected, sizeof(unexpected), 0);
    if (seen == 0) {
      return true;
    }
    if (seen < 0 && errno != EINTR) {
      return false;
    }
  }
}

static void answer(int connection, const char *mount_point) {
  char request[REQUEST_MAX_BYTES];
  if (!read_request(connection, request, sizeof(request))) {
    return;
  }
  if (strcmp(request, FREEZE_REQUEST) != 0) {
    reply(connection, UNKNOWN_REQUEST);
    return;
  }
  if (!guest_control_freeze(mount_point)) {
    log_errno("could not freeze %s", mount_point);
    reply(connection, FREEZE_REFUSED);
    return;
  }
  if (reply(connection, FREEZE_HELD) && !wait_until_released(connection)) {
    log_line("the host held %s frozen for %ums without letting go; thawing it", mount_point,
             MAX_FREEZE_HOLD_MS);
  }
  if (!guest_control_thaw(mount_point)) {
    log_errno("could not thaw %s", mount_point);
  }
}

static void serve(const char *mount_point) {
  int listener = listen_on_control_port();
  if (listener < 0) {
    return;
  }
  log_line("the control channel is listening on vsock port %u", GUEST_CONTROL_VSOCK_PORT);
  for (;;) {
    int connection = accept(listener, NULL, NULL);
    if (connection < 0) {
      if (errno == EINTR || errno == ECONNABORTED) {
        continue;
      }
      log_errno("could not accept a control connection");
      break;
    }
    answer(connection, mount_point);
    close(connection);
  }
  close(listener);
}

void guest_control_start(struct guest_control *control) {
  pid_t process = fork();
  if (process < 0) {
    log_errno("could not start the control channel");
    control->process = -1;
    return;
  }
  if (process == 0) {
    serve(control->mount_point);
    _exit(0);
  }
  control->process = process;
}

void guest_control_stop(const struct guest_control *control) {
  /* Nothing froze the filesystem if nothing was ever listening, and a boot that failed
   * before the mount would have nothing to open either. */
  if (control->process <= 0) {
    return;
  }
  /* SIGKILL, not SIGTERM: PID 1 blocked the supervised signals before this process was
   * forked, so it inherited a mask that would swallow anything catchable. */
  kill(control->process, SIGKILL);
  while (waitpid(control->process, NULL, 0) < 0 && errno == EINTR) {
  }
  /* EINVAL is the filesystem saying it was not frozen, which is the ordinary case: the
   * host holds a freeze only for as long as it is reading. */
  if (!guest_control_thaw(control->mount_point) && errno != EINVAL) {
    log_errno("could not thaw %s", control->mount_point);
  }
}
