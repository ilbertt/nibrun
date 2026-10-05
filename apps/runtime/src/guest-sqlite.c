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

void guest_sqlite_serve(const struct guest_sqlite_listener *channel) {
  if (!prepare_signals()) {
    close(channel->descriptor);
    return;
  }
  size_t workers = 0;
  while (!stopping) {
    while (waitpid(-1, NULL, WNOHANG) > 0)
      if (workers > 0)
        workers--;
    struct pollfd peer = {.fd = channel->descriptor, .events = POLLIN};
    if (poll(&peer, 1, 100) <= 0 || stopping)
      continue;
    int connection = accept4(channel->descriptor, NULL, NULL, SOCK_CLOEXEC);
    if (connection < 0)
      continue;
    if (workers >= SQLITE_MAX_WORKERS) {
      guest_sqlite_refuse(connection);
      close(connection);
      continue;
    }
    sigset_t blocked, previous;
    sigemptyset(&blocked);
    sigaddset(&blocked, SIGTERM);
    if (sigprocmask(SIG_BLOCK, &blocked, &previous) < 0) {
      close(connection);
      continue;
    }
    pid_t parent = getpid();
    pid_t process = fork();
    if (process == 0) {
      close(channel->descriptor);
      if (prctl(PR_SET_PDEATHSIG, SIGTERM) < 0 || getppid() != parent)
        _exit(1);
      const struct guest_sqlite_request request = {.connection = connection,
                                                   .mount_point = channel->mount_point,
                                                   .timeout_ms = channel->timeout_ms};
      guest_sqlite_answer(&request);
      close(connection);
      _exit(0);
    }
    sigprocmask(SIG_SETMASK, &previous, NULL);
    if (process > 0)
      workers++;
    else
      guest_sqlite_refuse(connection);
    close(connection);
  }
  close(channel->descriptor);
  kill(-getpgrp(), SIGTERM);
  while (waitpid(-1, NULL, 0) > 0 || errno == EINTR) {
  }
}

void guest_sqlite_start(struct guest_sqlite *channel) {
  pid_t parent = getpid();
  pid_t process = fork();
  if (process == 0) {
    if (setpgid(0, 0) < 0 || prctl(PR_SET_PDEATHSIG, SIGTERM) < 0 || getppid() != parent)
      _exit(1);
    int listener = socket(AF_VSOCK, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0);
    struct vsock_address address = {
        .family = AF_VSOCK, .port = GUEST_SQLITE_VSOCK_PORT, .cid = VMADDR_CID_ANY};
    if (listener < 0 || bind(listener, (const struct sockaddr *)&address, sizeof(address)) < 0 ||
        listen(listener, SQLITE_MAX_WORKERS) < 0) {
      log_errno("could not listen on the SQLite socket");
      _exit(1);
    }
    log_line("the SQLite channel is listening on vsock port %u", GUEST_SQLITE_VSOCK_PORT);
    const struct guest_sqlite_listener serving = {.descriptor = listener,
                                                  .mount_point = channel->mount_point,
                                                  .timeout_ms = SQLITE_SESSION_IDLE_MS};
    guest_sqlite_serve(&serving);
    _exit(0);
  }
  if (process < 0)
    log_errno("could not start the SQLite channel");
  else
    setpgid(process, process);
  channel->process = process;
}

void guest_sqlite_stop(const struct guest_sqlite *channel) {
  if (channel->process <= 0)
    return;
  kill(-channel->process, SIGTERM);
  while (waitpid(channel->process, NULL, 0) < 0 && errno == EINTR) {
  }
}
