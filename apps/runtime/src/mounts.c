#include "mounts.h"

#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include "log.h"

#define DEVICE_POLL_INTERVAL_MS 10
#define DEVICE_WAIT_TIMEOUT_MS 5000
#define NS_PER_MS 1000000L

struct mount_request {
  const char *source;
  const char *target;
  const char *filesystem;
  unsigned long flags;
  const char *options;
  /* mount(2) answers EBUSY when the same filesystem is already mounted at the same
   * place, which for a pseudo-filesystem is the state being asked for. Never set
   * for a drive: there EBUSY can also mean the block device is held by something
   * else, and carrying on would leave the tenant writing to a tmpfs it thinks is
   * its volume. */
  bool tolerate_existing;
};

static bool perform(const struct mount_request *request) {
  if (mount(request->source, request->target, request->filesystem, request->flags, request->options) == 0) {
    return true;
  }
  if (errno == EBUSY && request->tolerate_existing) {
    log_line("%s was already mounted on %s", request->filesystem, request->target);
    return true;
  }
  log_errno("could not mount %s on %s", request->source, request->target);
  return false;
}

static bool ensure_directory(const char *path, mode_t mode) {
  if (mkdir(path, mode) < 0 && errno != EEXIST) {
    log_errno("could not create %s", path);
    return false;
  }
  return true;
}

bool mounts_dev(void) {
  /* The guest kernel is built with CONFIG_DEVTMPFS_MOUNT, so /dev is already a
   * populated devtmpfs before init is executed. Mounting a second one over it would
   * work — devtmpfs has a single instance — but stacking a mount to arrive at the
   * same content is not worth the line. This covers the kernel that does not. */
  if (access("/dev/null", F_OK) == 0) {
    return true;
  }
  return perform(&(struct mount_request){.source = "devtmpfs",
                                         .target = "/dev",
                                         .filesystem = "devtmpfs",
                                         .flags = MS_NOSUID | MS_NOEXEC,
                                         .options = "mode=0755",
                                         .tolerate_existing = true});
}

bool mounts_tmpfs(const char *target, const char *options) {
  return perform(&(struct mount_request){
      .source = "tmpfs", .target = target, .filesystem = "tmpfs", .flags = MS_NOSUID | MS_NODEV,
      .options = options});
}

bool mounts_pseudo_filesystems(void) {
  static const struct mount_request REQUESTS[] = {
      {.source = "proc",
       .target = "/proc",
       .filesystem = "proc",
       .flags = MS_NOSUID | MS_NODEV | MS_NOEXEC,
       .tolerate_existing = true},
      {.source = "sysfs",
       .target = "/sys",
       .filesystem = "sysfs",
       .flags = MS_NOSUID | MS_NODEV | MS_NOEXEC,
       .tolerate_existing = true},
      {.source = "tmpfs",
       .target = "/run",
       .filesystem = "tmpfs",
       .flags = MS_NOSUID | MS_NODEV,
       .options = "mode=0755," RUNTIME_TMPFS_SIZE},
      {.source = "tmpfs",
       .target = "/tmp",
       .filesystem = "tmpfs",
       .flags = MS_NOSUID | MS_NODEV,
       .options = "mode=1777," TENANT_TMPFS_SIZE},
      {.source = "tmpfs",
       .target = "/dev/shm",
       .filesystem = "tmpfs",
       .flags = MS_NOSUID | MS_NODEV,
       .options = "mode=1777," TENANT_TMPFS_SIZE},
  };

  /* Every other mount point here is a directory the image carries. /dev is a
   * devtmpfs the kernel populates, so this one has to be made. */
  if (!ensure_directory("/dev/shm", 01777)) {
    return false;
  }
  for (size_t index = 0; index < sizeof(REQUESTS) / sizeof(REQUESTS[0]); index++) {
    if (!perform(&REQUESTS[index])) {
      return false;
    }
  }
  return true;
}

static bool mount_squashfs(const char *device, const char *target, unsigned long flags) {
  if (!mounts_wait_for_device(device, DEVICE_WAIT_TIMEOUT_MS) || !ensure_directory(target, 0755)) {
    return false;
  }
  return perform(&(struct mount_request){.source = device,
                                         .target = target,
                                         .filesystem = "squashfs",
                                         .flags = MS_RDONLY | MS_NOSUID | MS_NODEV | flags});
}

bool mounts_config(const char *device, const char *target) {
  return mount_squashfs(device, target, MS_NOEXEC);
}

bool mounts_artifact(const char *device, const char *target) {
  return mount_squashfs(device, target, 0);
}

bool mounts_tenant_data(const struct tenant_data_mount *request) {
  if (!mounts_wait_for_device(request->device, DEVICE_WAIT_TIMEOUT_MS) ||
      !ensure_directory(request->target, 0755)) {
    return false;
  }
  /* noatime, not the default relatime: every atime update is a block write that
   * has to reach S3 underneath the volume. */
  if (!perform(&(struct mount_request){.source = request->device,
                                       .target = request->target,
                                       .filesystem = "ext4",
                                       .flags = MS_NOSUID | MS_NODEV | MS_NOATIME})) {
    return false;
  }
  if (chown(request->target, request->uid, request->gid) < 0) {
    log_errno("could not give %s to uid %u", request->target, request->uid);
    return false;
  }
  return true;
}

bool mounts_wait_for_device(const char *path, uint32_t timeout_ms) {
  struct stat details;
  for (uint32_t waited_ms = 0;; waited_ms += DEVICE_POLL_INTERVAL_MS) {
    if (stat(path, &details) == 0) {
      if (waited_ms > 0) {
        log_line("%s appeared after %ums", path, waited_ms);
      }
      return true;
    }
    if (waited_ms >= timeout_ms) {
      log_errno("%s never appeared", path);
      return false;
    }
    nanosleep(&(struct timespec){0, DEVICE_POLL_INTERVAL_MS * NS_PER_MS}, NULL);
  }
}
