#ifndef NIBRUN_GUEST_CONTROL_H
#define NIBRUN_GUEST_CONTROL_H

#include <stdbool.h>
#include <sys/types.h>

/* The host asks for the tenant's filesystem to be held still while it reads the
 * block device underneath. It cannot do that from its own side: the guest holds the
 * same filesystem mounted read-write, and what has only reached ext4's journal is
 * not yet in the place the host reads. Only the kernel that owns the mount can put
 * it there. */

struct guest_control {
  pid_t process;
  const char *mount_point;
};

/* Answers the host in a child of PID 1 rather than on the supervisor's poll loop,
 * which does not run while the tenant is between restarts. Failing to start is not
 * fatal: the tenant still runs, and an export that cannot freeze fails on the host.
 *
 * The guest kernel is built without CONFIG_VSOCKETS_LOOPBACK, so the tenant cannot
 * reach this listener — the only peer a guest vsock port has is the host. */
void guest_control_start(struct guest_control *control);

/* Ends the control process and leaves the filesystem thawed. Both halves are
 * needed: a freeze is superblock state that outlives whoever asked for it, so
 * killing the process does not lift it, and unmounting a frozen filesystem blocks
 * for as long as it stays frozen. */
void guest_control_stop(const struct guest_control *control);

/* ext4 answers a freeze by checkpointing its journal, which is the whole point: it
 * moves every committed change out of a log the host never replays and into the
 * blocks the host does read. */
bool guest_control_freeze(const char *mount_point);

/* False with errno set, so a caller can tell a filesystem that refused to thaw from
 * one that was never frozen (EINVAL). */
bool guest_control_thaw(const char *mount_point);

#endif
