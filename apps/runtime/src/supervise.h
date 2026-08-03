#ifndef NIBRUN_SUPERVISE_H
#define NIBRUN_SUPERVISE_H

#include <stdint.h>
#include <sys/types.h>

#include "config.h"

struct tenant_process {
  const char *executable;
  const char *working_directory;
  char *const *environment;
  uid_t uid;
  gid_t gid;
};

struct supervisor {
  struct tenant_process tenant;
  struct restart_policy policy;
  /* How long the tenant gets between SIGTERM and SIGKILL. The agent's own wait for
   * the microVM to exit has to be longer than this or it will never observe the
   * difference between a clean stop and a killed one. */
  uint32_t shutdown_grace_ms;
};

enum supervise_outcome {
  SUPERVISE_SHUTDOWN_REQUESTED,
  SUPERVISE_RESTART_BUDGET_EXHAUSTED,
  SUPERVISE_SPAWN_FAILED,
};

/* Must be called before the first fork, and early enough that a shutdown arriving
 * during boot is still honoured: PID 1 discards signals it has neither blocked nor
 * handled, so an unblocked SIGINT before this point is gone for good. */
void supervise_block_signals(void);

/* Runs the tenant until it is asked to stop or has exhausted its restart budget.
 * Every child that dies is reaped, tenant or not — nobody else in the guest will. */
enum supervise_outcome supervise(const struct supervisor *supervisor);

uint32_t supervise_backoff_ms(const struct restart_policy *policy, uint32_t restart_count);

#endif
