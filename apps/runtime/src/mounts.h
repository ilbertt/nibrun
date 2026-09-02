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

/* A tmpfs is guest memory wearing a filesystem, and one mounted without a size gets
 * half of it. That default is why a tenant filling /tmp is OOM-killed rather than told
 * ENOSPC: the pages are unevictable with no swap, so the write competes with the heap
 * of the process making it and the killer arrives before the filesystem is full.
 *
 * A percentage because guest memory is configurable from 128 MiB to 16 GiB and the
 * kernel resolves the fraction itself; a byte count here would mean reading
 * /proc/meminfo to arrive at the same number. Whole ones only — it parses the figure
 * with memparse and refuses size=12.5%.
 *
 * A quarter each — 64 MiB apiece at the 256 MiB default, and the two of them full still
 * leave the tenant half its memory. Room deliberately left: a ceiling low enough to stop
 * a leak early is also low enough to break an app writing honestly to the TMPDIR it was
 * handed, and only one of those two is a fault of ours.
 *
 * What the room costs is worth knowing, because nothing here is ever emptied. A snapshot
 * is exactly the guest's RAM, so what a tenant leaves in /tmp is restored with it on
 * every wake and outlives everything short of a redeploy: memory spent rather than
 * scratch returned, and an app can take months of sleeps to reach a ceiling it would
 * have met in an afternoon. */
#define TENANT_TMPFS_SIZE "size=25%"

/* /app and /run are mode 0755 owned by root, and hold two mount points and a
 * resolv.conf. Nothing a tenant does grows them, so they do not scale with the guest. */
#define RUNTIME_TMPFS_SIZE "size=1M"

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
