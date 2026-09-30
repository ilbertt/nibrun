#include "tenant-process.h"

#include <grp.h>
#include <signal.h>
#include <unistd.h>

#include "log.h"

#define TENANT_SPAWN_EXIT_CODE 126

#define OR_GIVE_UP(call, description)                       \
  do {                                                      \
    if ((call) < 0) {                                       \
      log_errno("could not %s for the tenant", description); \
      _exit(TENANT_SPAWN_EXIT_CODE);                        \
    }                                                       \
  } while (0)

static void close_redirected(int descriptor) {
  if (descriptor > STDERR_FILENO) {
    close(descriptor);
  }
}

_Noreturn void tenant_process_exec(const struct tenant_launch *launch) {
  const struct tenant_process *tenant = launch->tenant;
  sigset_t none;
  sigemptyset(&none);
  OR_GIVE_UP(sigprocmask(SIG_SETMASK, &none, NULL), "unblock signals");

  if (launch->input >= 0) {
    OR_GIVE_UP(dup2(launch->input, STDIN_FILENO), "attach stdin");
  }
  OR_GIVE_UP(dup2(launch->output, STDOUT_FILENO), "attach stdout");
  OR_GIVE_UP(dup2(launch->errors, STDERR_FILENO), "attach stderr");
  close_redirected(launch->input);
  close_redirected(launch->output);
  if (launch->errors != launch->output) {
    close_redirected(launch->errors);
  }

  /* Both supervised binaries and cron commands need their own group so cancellation
   * can reach descendants without signalling another tenant process. */
  OR_GIVE_UP(setsid(), "open a session");
  OR_GIVE_UP(chdir(tenant->working_directory), "change directory");
  OR_GIVE_UP(setgroups(0, NULL), "drop supplementary groups");
  OR_GIVE_UP(setgid(tenant->gid), "drop to its gid");
  OR_GIVE_UP(setuid(tenant->uid), "drop to its uid");
  execve(tenant->executable, tenant->argv, tenant->environment);
  log_errno("could not execute the tenant process");
  _exit(TENANT_SPAWN_EXIT_CODE);
}
