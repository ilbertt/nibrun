#include "supervise.h"

#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
#include <sys/signalfd.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#include "clock.h"
#include "log.h"

#define MS_PER_SECOND 1000
#define NS_PER_MS 1000000L
#define TENANT_SPAWN_EXIT_CODE 126
#define SIGKILL_GRACE_MS 2000
#define OUTPUT_CHUNK_BYTES 4096
/* How long the supervisor may sit in poll before giving the output sink a turn. A tenant that
 * prints nothing for hours is ordinary, and it is exactly the tenant whose sink can lose its far
 * end without anything here noticing. One wakeup a second buys that back for a syscall. */
#define OUTPUT_SERVICE_INTERVAL_MS 1000

/* Blocked rather than handled, and waited on synchronously: there is no signal
 * handler, so there is no async-signal-safety to get wrong, and a signal that
 * arrives while the supervisor is busy stays pending instead of being lost. */
static const int SUPERVISED_SIGNALS[] = {SIGCHLD, SIGTERM, SIGINT};

enum shutdown_phase {
  PHASE_RUNNING,
  PHASE_TERM_SENT,
  PHASE_KILL_SENT,
};

struct wait_result {
  bool shutdown_requested;
  bool exited;
  int status;
};

static sigset_t supervised_signals(void) {
  sigset_t signals;
  sigemptyset(&signals);
  for (size_t index = 0; index < sizeof(SUPERVISED_SIGNALS) / sizeof(SUPERVISED_SIGNALS[0]); index++) {
    sigaddset(&signals, SUPERVISED_SIGNALS[index]);
  }
  return signals;
}

void supervise_block_signals(void) {
  sigset_t signals = supervised_signals();
  if (sigprocmask(SIG_BLOCK, &signals, NULL) < 0) {
    log_errno("could not block signals");
  }
}

static struct timespec remaining_until(uint64_t deadline_ms) {
  uint64_t now = clock_monotonic_ms();
  uint64_t left = deadline_ms > now ? deadline_ms - now : 0;
  return (struct timespec){(time_t)(left / MS_PER_SECOND), (long)(left % MS_PER_SECOND) * NS_PER_MS};
}

/* The tenant is a session leader, so its whole group can be signalled at once. The
 * fallback covers the window between fork and the child's setsid, where the group
 * does not exist yet. */
static void signal_tenant(pid_t tenant, int signal_number) {
  if (kill(-tenant, signal_number) < 0 && errno == ESRCH) {
    kill(tenant, signal_number);
  }
}

static struct wait_result reap_children(pid_t tenant) {
  struct wait_result result = {0};
  for (;;) {
    int status;
    pid_t reaped = waitpid(-1, &status, WNOHANG);
    if (reaped <= 0) {
      return result;
    }
    if (reaped == tenant) {
      result.exited = true;
      result.status = status;
    }
  }
}

#define OR_GIVE_UP(call, description)                       \
  do {                                                      \
    if ((call) < 0) {                                       \
      log_errno("could not %s for the tenant", description); \
      _exit(TENANT_SPAWN_EXIT_CODE);                        \
    }                                                       \
  } while (0)

static _Noreturn void become_tenant(const struct tenant_process *tenant, int stdout_descriptor,
                                    int stderr_descriptor) {
  sigset_t none;
  sigemptyset(&none);
  sigprocmask(SIG_SETMASK, &none, NULL);

  OR_GIVE_UP(dup2(stdout_descriptor, STDOUT_FILENO), "attach stdout");
  OR_GIVE_UP(dup2(stderr_descriptor, STDERR_FILENO), "attach stderr");
  close(stdout_descriptor);
  close(stderr_descriptor);

  /* Its own session: the tenant's own children can then be signalled as a group,
   * and sharing the console with PID 1 cannot make job control stop it. */
  OR_GIVE_UP(setsid(), "open a session");
  OR_GIVE_UP(chdir(tenant->working_directory), "change directory");
  OR_GIVE_UP(setgroups(0, NULL), "drop supplementary groups");
  OR_GIVE_UP(setgid(tenant->gid), "drop to its gid");
  OR_GIVE_UP(setuid(tenant->uid), "drop to its uid");

  execve(tenant->executable, tenant->argv, tenant->environment);
  log_errno("could not run %s", tenant->executable);
  _exit(TENANT_SPAWN_EXIT_CODE);
}

static void close_descriptor(int *descriptor) {
  if (*descriptor >= 0) {
    close(*descriptor);
    *descriptor = -1;
  }
}

static void drain_output(int *descriptor, enum tenant_output_stream stream,
                         const struct tenant_output *output) {
  if (*descriptor < 0) {
    return;
  }
  unsigned char buffer[OUTPUT_CHUNK_BYTES];
  for (;;) {
    ssize_t length = read(*descriptor, buffer, sizeof(buffer));
    if (length > 0) {
      if (output->write != NULL) {
        output->write(output->context, stream, buffer, (size_t)length);
      }
      continue;
    }
    if (length == 0) {
      close_descriptor(descriptor);
      return;
    }
    if (errno == EINTR) {
      continue;
    }
    if (errno != EAGAIN && errno != EWOULDBLOCK) {
      log_errno("could not read tenant output");
      close_descriptor(descriptor);
    }
    return;
  }
}

static bool open_output_pipe(int descriptors[2]) {
  if (pipe2(descriptors, O_CLOEXEC) < 0) {
    return false;
  }
  int flags = fcntl(descriptors[0], F_GETFL);
  if (flags >= 0 && fcntl(descriptors[0], F_SETFL, flags | O_NONBLOCK) == 0) {
    return true;
  }
  close(descriptors[0]);
  close(descriptors[1]);
  return false;
}

static void drain_ready_output(struct pollfd *polled, int *stdout_descriptor, int *stderr_descriptor,
                               const struct tenant_output *output) {
  if ((polled[1].revents & (POLLIN | POLLHUP)) != 0) {
    drain_output(stdout_descriptor, TENANT_OUTPUT_STDOUT, output);
  }
  if ((polled[2].revents & (POLLIN | POLLHUP)) != 0) {
    drain_output(stderr_descriptor, TENANT_OUTPUT_STDERR, output);
  }
}

static struct wait_result wait_for_tenant(pid_t tenant, uint32_t grace_ms, int stdout_descriptor,
                                          int stderr_descriptor, const struct tenant_output *output) {
  sigset_t signals = supervised_signals();
  enum shutdown_phase phase = PHASE_RUNNING;
  uint64_t deadline_ms = 0;
  int signal_descriptor = signalfd(-1, &signals, SFD_CLOEXEC | SFD_NONBLOCK);
  if (signal_descriptor < 0) {
    log_errno("could not open the supervisor signal descriptor");
    close_descriptor(&stdout_descriptor);
    close_descriptor(&stderr_descriptor);
    return (struct wait_result){.shutdown_requested = true};
  }

  for (;;) {
    struct pollfd polled[] = {
        {.fd = signal_descriptor, .events = POLLIN},
        {.fd = stdout_descriptor, .events = POLLIN},
        {.fd = stderr_descriptor, .events = POLLIN},
    };
    int timeout_ms =
        phase == PHASE_RUNNING ? OUTPUT_SERVICE_INTERVAL_MS : clock_remaining_ms(deadline_ms);
    int ready = poll(polled, sizeof(polled) / sizeof(polled[0]), timeout_ms);
    if (ready < 0 && errno == EINTR) {
      continue;
    }
    if (ready < 0) {
      log_errno("could not wait for the tenant");
      close(signal_descriptor);
      close_descriptor(&stdout_descriptor);
      close_descriptor(&stderr_descriptor);
      return (struct wait_result){.shutdown_requested = true};
    }

    if (ready == 0) {
      /* Nothing happened, which while the tenant is running is not a deadline but the quiet the
       * sink needs a turn in. */
      if (phase == PHASE_RUNNING) {
        if (output->service != NULL) {
          output->service(output->context);
        }
        continue;
      }
      if (phase == PHASE_TERM_SENT) {
        log_line("the tenant is still running %ums after SIGTERM; killing it", grace_ms);
        signal_tenant(tenant, SIGKILL);
        phase = PHASE_KILL_SENT;
        deadline_ms = clock_monotonic_ms() + SIGKILL_GRACE_MS;
        continue;
      }
      log_line("the tenant survived SIGKILL; shutting the guest down without it");
      close(signal_descriptor);
      close_descriptor(&stdout_descriptor);
      close_descriptor(&stderr_descriptor);
      return (struct wait_result){.shutdown_requested = true};
    }

    drain_ready_output(polled, &stdout_descriptor, &stderr_descriptor, output);

    if ((polled[0].revents & POLLIN) == 0) {
      continue;
    }
    for (;;) {
      struct signalfd_siginfo received;
      ssize_t length = read(signal_descriptor, &received, sizeof(received));
      if (length < 0 && errno == EINTR) {
        continue;
      }
      if (length < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
        break;
      }
      if (length != sizeof(received)) {
        log_errno("could not read the supervisor signal descriptor");
        close(signal_descriptor);
        close_descriptor(&stdout_descriptor);
        close_descriptor(&stderr_descriptor);
        return (struct wait_result){.shutdown_requested = true};
      }

      if (received.ssi_signo == SIGCHLD) {
        struct wait_result reaped = reap_children(tenant);
        if (reaped.exited) {
          drain_output(&stdout_descriptor, TENANT_OUTPUT_STDOUT, output);
          drain_output(&stderr_descriptor, TENANT_OUTPUT_STDERR, output);
          close(signal_descriptor);
          close_descriptor(&stdout_descriptor);
          close_descriptor(&stderr_descriptor);
          reaped.shutdown_requested = phase != PHASE_RUNNING;
          return reaped;
        }
        continue;
      }

      if (phase == PHASE_RUNNING) {
        log_line("shutdown requested; asking the tenant to stop");
        signal_tenant(tenant, SIGTERM);
        phase = PHASE_TERM_SENT;
        deadline_ms = clock_monotonic_ms() + grace_ms;
      }
    }
  }
}

static bool sleep_or_shutdown(uint32_t duration_ms) {
  sigset_t signals = supervised_signals();
  uint64_t deadline_ms = clock_monotonic_ms() + duration_ms;

  for (;;) {
    struct timespec remaining = remaining_until(deadline_ms);
    siginfo_t received;
    int signal_number = sigtimedwait(&signals, &received, &remaining);
    if (signal_number < 0) {
      if (errno == EINTR) {
        continue;
      }
      if (errno != EAGAIN) {
        log_errno("could not wait for a signal");
        return true;
      }
      return false;
    }
    if (signal_number != SIGCHLD) {
      return true;
    }
    (void)reap_children(0);
  }
}

uint32_t supervise_backoff_ms(const struct restart_policy *policy, uint32_t restart_count) {
  double delay_ms = policy->initial_backoff_ms;
  for (uint32_t step = 0; step < restart_count && delay_ms < policy->max_backoff_ms; step++) {
    delay_ms *= policy->backoff_factor;
  }
  return delay_ms >= policy->max_backoff_ms ? policy->max_backoff_ms : (uint32_t)delay_ms;
}

static void log_tenant_exit(int status, uint64_t uptime_ms) {
  if (WIFEXITED(status)) {
    log_line("the tenant exited with status %d after %llums", WEXITSTATUS(status),
             (unsigned long long)uptime_ms);
  } else if (WIFSIGNALED(status)) {
    log_line("the tenant was killed by signal %d after %llums", WTERMSIG(status),
             (unsigned long long)uptime_ms);
  } else {
    log_line("the tenant stopped with wait status %#x after %llums", status, (unsigned long long)uptime_ms);
  }
}

enum supervise_outcome supervise(const struct supervisor *supervisor) {
  uint32_t restarts = 0;

  for (;;) {
    uint64_t started_ms = clock_monotonic_ms();
    int stdout_pipe[2];
    int stderr_pipe[2];
    if (!open_output_pipe(stdout_pipe)) {
      log_errno("could not open the tenant stdout pipe");
      return SUPERVISE_SPAWN_FAILED;
    }
    if (!open_output_pipe(stderr_pipe)) {
      log_errno("could not open the tenant stderr pipe");
      close(stdout_pipe[0]);
      close(stdout_pipe[1]);
      return SUPERVISE_SPAWN_FAILED;
    }
    pid_t tenant = fork();
    if (tenant < 0) {
      log_errno("could not fork");
      close(stdout_pipe[0]);
      close(stdout_pipe[1]);
      close(stderr_pipe[0]);
      close(stderr_pipe[1]);
      return SUPERVISE_SPAWN_FAILED;
    }
    if (tenant == 0) {
      close(stdout_pipe[0]);
      close(stderr_pipe[0]);
      become_tenant(&supervisor->tenant, stdout_pipe[1], stderr_pipe[1]);
    }
    close(stdout_pipe[1]);
    close(stderr_pipe[1]);

    struct wait_result result = wait_for_tenant(tenant, supervisor->shutdown_grace_ms, stdout_pipe[0],
                                                stderr_pipe[0], &supervisor->output);
    /* Anything the tenant left behind goes with it. A survivor still holding the
     * listening socket would make every restart fail to bind. */
    signal_tenant(tenant, SIGKILL);
    if (result.shutdown_requested) {
      return SUPERVISE_SHUTDOWN_REQUESTED;
    }

    uint64_t uptime_ms = clock_monotonic_ms() - started_ms;
    log_tenant_exit(result.status, uptime_ms);

    if (uptime_ms >= supervisor->policy.reset_after_ms && restarts > 0) {
      log_line("the tenant had been up for %llums, so its restart count starts again",
               (unsigned long long)uptime_ms);
      restarts = 0;
    }
    if (restarts >= supervisor->policy.max_restarts) {
      return SUPERVISE_RESTART_BUDGET_EXHAUSTED;
    }

    uint32_t backoff_ms = supervise_backoff_ms(&supervisor->policy, restarts);
    restarts++;
    log_line("restarting the tenant in %ums (restart %u of %u)", backoff_ms, restarts,
             supervisor->policy.max_restarts);
    if (sleep_or_shutdown(backoff_ms)) {
      return SUPERVISE_SHUTDOWN_REQUESTED;
    }
  }
}
