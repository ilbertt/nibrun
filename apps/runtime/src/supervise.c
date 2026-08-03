#include "supervise.h"

#include <errno.h>
#include <grp.h>
#include <signal.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#include "log.h"

#define MS_PER_SECOND 1000
#define NS_PER_MS 1000000L
#define TENANT_SPAWN_EXIT_CODE 126
#define SIGKILL_GRACE_MS 2000

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

static uint64_t monotonic_ms(void) {
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  return (uint64_t)now.tv_sec * MS_PER_SECOND + (uint64_t)now.tv_nsec / (uint64_t)NS_PER_MS;
}

static struct timespec remaining_until(uint64_t deadline_ms) {
  uint64_t now = monotonic_ms();
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

static _Noreturn void become_tenant(const struct tenant_process *tenant) {
  sigset_t none;
  sigemptyset(&none);
  sigprocmask(SIG_SETMASK, &none, NULL);

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

static struct wait_result wait_for_tenant(pid_t tenant, uint32_t grace_ms) {
  sigset_t signals = supervised_signals();
  enum shutdown_phase phase = PHASE_RUNNING;
  uint64_t deadline_ms = 0;

  for (;;) {
    struct timespec remaining;
    const struct timespec *timeout = NULL;
    if (phase != PHASE_RUNNING) {
      remaining = remaining_until(deadline_ms);
      timeout = &remaining;
    }

    siginfo_t received;
    int signal_number = sigtimedwait(&signals, &received, timeout);

    if (signal_number < 0 && errno == EINTR) {
      continue;
    }
    if (signal_number < 0 && errno != EAGAIN) {
      log_errno("could not wait for a signal");
      return (struct wait_result){.shutdown_requested = true};
    }
    if (signal_number < 0) {
      if (phase == PHASE_TERM_SENT) {
        log_line("the tenant is still running %ums after SIGTERM; killing it", grace_ms);
        signal_tenant(tenant, SIGKILL);
        phase = PHASE_KILL_SENT;
        deadline_ms = monotonic_ms() + SIGKILL_GRACE_MS;
        continue;
      }
      log_line("the tenant survived SIGKILL; shutting the guest down without it");
      return (struct wait_result){.shutdown_requested = true};
    }

    if (signal_number == SIGCHLD) {
      struct wait_result reaped = reap_children(tenant);
      if (reaped.exited) {
        reaped.shutdown_requested = phase != PHASE_RUNNING;
        return reaped;
      }
      continue;
    }

    if (phase == PHASE_RUNNING) {
      log_line("shutdown requested; asking the tenant to stop");
      signal_tenant(tenant, SIGTERM);
      phase = PHASE_TERM_SENT;
      deadline_ms = monotonic_ms() + grace_ms;
    }
  }
}

static bool sleep_or_shutdown(uint32_t duration_ms) {
  sigset_t signals = supervised_signals();
  uint64_t deadline_ms = monotonic_ms() + duration_ms;

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
    uint64_t started_ms = monotonic_ms();
    pid_t tenant = fork();
    if (tenant < 0) {
      log_errno("could not fork");
      return SUPERVISE_SPAWN_FAILED;
    }
    if (tenant == 0) {
      become_tenant(&supervisor->tenant);
    }

    struct wait_result result = wait_for_tenant(tenant, supervisor->shutdown_grace_ms);
    /* Anything the tenant left behind goes with it. A survivor still holding the
     * listening socket would make every restart fail to bind. */
    signal_tenant(tenant, SIGKILL);
    if (result.shutdown_requested) {
      return SUPERVISE_SHUTDOWN_REQUESTED;
    }

    uint64_t uptime_ms = monotonic_ms() - started_ms;
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
