#ifndef NIBRUN_MOUNTS_H
#define NIBRUN_MOUNTS_H

#include <stdbool.h>
#include <stdint.h>
#include <sys/types.h>

/* devtmpfs on /dev, on its own and first: the rootfs image carries no device
 * nodes, so until this runs there is no /dev/console for the kernel or for the
 * runtime to report anything on. */
bool mounts_dev(void);

/* /proc, /sys, /run, /tmp and /dev/shm. The root is read-only for the life of the
 * VM, so every writable path in the guest is one of these. */
bool mounts_pseudo_filesystems(void);

bool mounts_tmpfs(const char *target, const char *options);

/* The instance config drive: squashfs, read-only, and nothing on it is ever run. */
bool mounts_config(const char *device, const char *target);

/* The tenant artifact drive: squashfs, read-only, and the one place exec is allowed. */
bool mounts_artifact(const char *device, const char *target);

struct tenant_data_mount {
  const char *device;
  const char *target;
  uid_t uid;
  gid_t gid;
};

/* The one writable filesystem the tenant gets, and the only path it owns. */
bool mounts_tenant_data(const struct tenant_data_mount *request);

/* Block devices other than the root are not guaranteed to have been probed by the
 * time init runs, and a boot that failed because a node appeared late would be
 * indistinguishable from one whose drive was never attached. */
bool mounts_wait_for_device(const char *path, uint32_t timeout_ms);

#endif
