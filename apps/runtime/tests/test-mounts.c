/* The mount sequence against a real kernel, in a mount namespace of its own. What
 * this cannot do is boot a microVM: the devices are loop devices rather than
 * virtio-blk, and the rootfs underneath is writable. Everything else — the
 * filesystem types, the flags each mount carries, and who ends up able to write
 * where — is the same code the guest runs.
 *
 * Argument 1 is a loop device holding a squashfs, argument 2 one holding an ext4
 * filesystem. tests/mounts.sh builds both. */

#include <errno.h>
#include <fcntl.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#include "../src/mounts.h"
#include "../src/paths.h"
#include "expect.h"

#define SQUASHFS_MOUNT "/run/test-artifact"
#define DATA_MOUNT "/run/test-data"

static bool mounted_with(const char *target, const char *option) {
  FILE *table = fopen("/proc/self/mounts", "r");
  if (table == NULL) {
    return false;
  }
  char line[1024];
  bool found = false;
  while (!found && fgets(line, sizeof(line), table) != NULL) {
    char device[256];
    char point[256];
    char type[64];
    char options[256];
    if (sscanf(line, "%255s %255s %63s %255s", device, point, type, options) != 4) {
      continue;
    }
    if (strcmp(point, target) != 0) {
      continue;
    }
    for (char *option_cursor = strtok(options, ","); option_cursor != NULL;
         option_cursor = strtok(NULL, ",")) {
      found = found || strcmp(option_cursor, option) == 0;
    }
  }
  fclose(table);
  return found;
}

static bool is_of_type(const char *target, const char *filesystem) {
  FILE *table = fopen("/proc/self/mounts", "r");
  if (table == NULL) {
    return false;
  }
  char line[1024];
  bool found = false;
  while (fgets(line, sizeof(line), table) != NULL) {
    char device[256];
    char point[256];
    char type[64];
    if (sscanf(line, "%255s %255s %63s", device, point, type) != 3) {
      continue;
    }
    if (strcmp(point, target) == 0 && strcmp(type, filesystem) == 0) {
      found = true;
    }
  }
  fclose(table);
  return found;
}

static size_t count_mounts_at(const char *target) {
  FILE *table = fopen("/proc/self/mounts", "r");
  if (table == NULL) {
    return 0;
  }
  char line[1024];
  size_t mounts = 0;
  while (fgets(line, sizeof(line), table) != NULL) {
    char device[256];
    char point[256];
    if (sscanf(line, "%255s %255s", device, point) == 2 && strcmp(point, target) == 0) {
      mounts++;
    }
  }
  fclose(table);
  return mounts;
}

static bool can_write_as_tenant(const char *directory) {
  pid_t child = fork();
  if (child == 0) {
    if (setgid(TENANT_GID) < 0 || setuid(TENANT_UID) < 0) {
      _exit(1);
    }
    char path[256];
    snprintf(path, sizeof(path), "%s/tenant-write-probe", directory);
    int descriptor = open(path, O_WRONLY | O_CREAT | O_EXCL, 0644);
    if (descriptor < 0) {
      _exit(1);
    }
    close(descriptor);
    unlink(path);
    _exit(0);
  }
  int status = 0;
  waitpid(child, &status, 0);
  return WIFEXITED(status) && WEXITSTATUS(status) == 0;
}

int main(int argc, char **argv) {
  if (argc != 3) {
    fprintf(stderr, "usage: test-mounts <squashfs-device> <ext4-device>\n");
    return 64;
  }
  const char *squashfs_device = argv[1];
  const char *ext4_device = argv[2];

  if (unshare(CLONE_NEWNS) < 0 || mount(NULL, "/", NULL, MS_REC | MS_PRIVATE, NULL) < 0) {
    fprintf(stderr, "needs a mount namespace: run this privileged\n");
    return 64;
  }

  EXPECT(mounts_tmpfs("/run", "mode=0755"));
  EXPECT(is_of_type("/run", "tmpfs"));
  EXPECT(mounted_with("/run", "nosuid"));
  EXPECT(mounted_with("/run", "nodev"));

  EXPECT(mounts_artifact(squashfs_device, SQUASHFS_MOUNT));
  EXPECT(is_of_type(SQUASHFS_MOUNT, "squashfs"));
  EXPECT(mounted_with(SQUASHFS_MOUNT, "ro"));
  EXPECT(mounted_with(SQUASHFS_MOUNT, "nosuid"));
  EXPECT(access(SQUASHFS_MOUNT "/server", X_OK) == 0);
  /* The artifact is the one mount the tenant's binary is executed from, so this is
   * the one that must not carry noexec. */
  EXPECT(!mounted_with(SQUASHFS_MOUNT, "noexec"));

  EXPECT(mounts_config(squashfs_device, "/run/test-config"));
  EXPECT(mounted_with("/run/test-config", "noexec"));

  EXPECT(mounts_tenant_data(&(struct tenant_data_mount){
      .device = ext4_device, .target = DATA_MOUNT, .uid = TENANT_UID, .gid = TENANT_GID}));
  EXPECT(is_of_type(DATA_MOUNT, "ext4"));
  EXPECT(mounted_with(DATA_MOUNT, "noatime"));
  EXPECT(can_write_as_tenant(DATA_MOUNT));
  /* Its own directory and nothing above it: /run stands in for the tmpfs the guest
   * mounts at /app, which the tenant must not be able to write. */
  EXPECT(!can_write_as_tenant("/run"));

  EXPECT(!mounts_artifact("/dev/does-not-exist", "/run/test-missing"));
  EXPECT(!mounts_tenant_data(&(struct tenant_data_mount){
      .device = squashfs_device, .target = "/run/test-not-ext4", .uid = TENANT_UID, .gid = TENANT_GID}));

  /* Last, because emptying /dev takes the loop devices above with it.
   *
   * The guest kernel has CONFIG_DEVTMPFS_MOUNT, so on real hardware /dev is already
   * a populated devtmpfs when init runs and mounting a second one there fails with
   * EBUSY. An earlier build did exactly that and never got past its first line. */
  size_t mounts_over_dev = count_mounts_at("/dev");
  EXPECT(mounts_dev());
  EXPECT(count_mounts_at("/dev") == mounts_over_dev);
  EXPECT(access("/dev/null", F_OK) == 0);

  /* And the kernel that did not: /dev empty, so devtmpfs has to be mounted. */
  EXPECT(mount("tmpfs", "/dev", "tmpfs", 0, "mode=0755") == 0);
  EXPECT(access("/dev/null", F_OK) != 0);
  EXPECT(mounts_dev());
  EXPECT(access("/dev/null", F_OK) == 0);

  return EXPECT_REPORT("mounts");
}
