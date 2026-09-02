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
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/sysinfo.h>
#include <sys/wait.h>
#include <unistd.h>

#include "../src/guest-control.h"
#include "../src/mounts.h"
#include "../src/paths.h"
#include "expect.h"

#define SQUASHFS_MOUNT "/run/test-artifact"
#define DATA_MOUNT "/run/test-data"
#define TENANT_TMPFS_MOUNT "/run/test-tenant-tmpfs"
#define FREEZE_HOLD_TEST_MS 200
#define GRANT_BYTES 8
#define KIBIBYTE_BYTES 1024
#define MEBIBYTE_BYTES (1024 * 1024)
#define UNBOUNDED_SHARE 2

/**
 * Drives the real control-channel loop over a socketpair, standing in for the vsock a
 * container has no Firecracker to carry. Both are SOCK_STREAM, so the code deciding when
 * a lease has ended is the same code either way.
 *
 * The host runs in a child because the loop blocks until the lease ends: `release` closes
 * the connection once the freeze is granted, and its absence is a host that took the
 * freeze and never came back.
 */
static enum guest_control_outcome answering(const char *request, bool release) {
  int pair[2];
  if (socketpair(AF_UNIX, SOCK_STREAM, 0, pair) < 0) {
    return GUEST_CONTROL_REFUSED;
  }
  pid_t host = fork();
  if (host == 0) {
    close(pair[0]);
    if (write(pair[1], request, strlen(request)) < 0) {
      _exit(1);
    }
    if (release) {
      char granted[GRANT_BYTES];
      /* Exiting closes the connection, which is the only way a host lets go. */
      _exit(read(pair[1], granted, sizeof(granted)) < 0 ? 1 : 0);
    }
    pause();
    _exit(0);
  }
  close(pair[1]);
  enum guest_control_outcome outcome = guest_control_answer(&(struct guest_control_request){
      .connection = pair[0], .mount_point = DATA_MOUNT, .max_hold_ms = FREEZE_HOLD_TEST_MS});
  close(pair[0]);
  kill(host, SIGKILL);
  waitpid(host, NULL, 0);
  return outcome;
}

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

/**
 * The ceiling tmpfs actually applied, which it reports as `size=<n>k` already resolved
 * from whatever the mount asked for. Reading it back is the only way to see what a
 * percentage came out as — and 0, the answer for a mount carrying no size at all, is
 * the unbounded default this exists to keep off the tenant-writable ones.
 */
static uint64_t mounted_size_bytes(const char *target) {
  FILE *table = fopen("/proc/self/mounts", "r");
  if (table == NULL) {
    return 0;
  }
  char line[1024];
  uint64_t bytes = 0;
  while (fgets(line, sizeof(line), table) != NULL) {
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
    for (char *cursor = strtok(options, ","); cursor != NULL; cursor = strtok(NULL, ",")) {
      unsigned long long kilobytes = 0;
      if (sscanf(cursor, "size=%lluk", &kilobytes) == 1) {
        bytes = (uint64_t)kilobytes * KIBIBYTE_BYTES;
      }
    }
  }
  fclose(table);
  return bytes;
}

static uint64_t total_memory_bytes(void) {
  struct sysinfo information;
  if (sysinfo(&information) < 0) {
    return 0;
  }
  return (uint64_t)information.totalram * information.mem_unit;
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

  EXPECT(mounts_tmpfs("/run", "mode=0755," RUNTIME_TMPFS_SIZE));
  EXPECT(is_of_type("/run", "tmpfs"));
  EXPECT(mounted_with("/run", "nosuid"));
  EXPECT(mounted_with("/run", "nodev"));
  EXPECT(mounted_size_bytes("/run") == MEBIBYTE_BYTES);

  /* The percentage form, resolved by the kernel and not by anything here. The way this
   * fails silently is a size= the kernel does not parse: the mount still succeeds, and
   * what it gets is the unbounded default this exists to keep off a tenant's /tmp. So
   * what is asserted is a ceiling that arrived and came in under that default. */
  EXPECT(mkdir(TENANT_TMPFS_MOUNT, 0755) == 0);
  EXPECT(mounts_tmpfs(TENANT_TMPFS_MOUNT, "mode=1777," TENANT_TMPFS_SIZE));
  EXPECT(mounted_size_bytes(TENANT_TMPFS_MOUNT) > 0);
  EXPECT(mounted_size_bytes(TENANT_TMPFS_MOUNT) < total_memory_bytes() / UNBOUNDED_SHARE);
  /* Unlike /app and /run: /tmp is the tenant's, and a ceiling on it is not a lock. */
  EXPECT(can_write_as_tenant(TENANT_TMPFS_MOUNT));

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

  /* A frozen filesystem cannot be asked whether it is frozen, and a write that proved
   * it would be a write that never returns. What answers instead is the pair of
   * refusals: a second freeze is EBUSY only while one is held, and a second thaw is
   * EINVAL only once none is. */
  EXPECT(guest_control_freeze(DATA_MOUNT));
  EXPECT(!guest_control_freeze(DATA_MOUNT) && errno == EBUSY);
  EXPECT(guest_control_thaw(DATA_MOUNT));
  EXPECT(!guest_control_thaw(DATA_MOUNT) && errno == EINVAL);
  EXPECT(can_write_as_tenant(DATA_MOUNT));

  /* However the connection ends, the tenant gets its filesystem back. A freeze is a lease
   * on something live and not a flag somebody has to remember to clear, so the EINVAL after
   * each of these is the whole point: it is the filesystem saying it is no longer frozen. */
  EXPECT(answering("FREEZE\n", true) == GUEST_CONTROL_RELEASED);
  EXPECT(!guest_control_thaw(DATA_MOUNT) && errno == EINVAL);
  EXPECT(can_write_as_tenant(DATA_MOUNT));

  /* The host that takes a freeze and never lets go: an agent wedged rather than gone, which
   * no closed connection will ever report. */
  EXPECT(answering("FREEZE\n", false) == GUEST_CONTROL_TIMED_OUT);
  EXPECT(!guest_control_thaw(DATA_MOUNT) && errno == EINVAL);
  EXPECT(can_write_as_tenant(DATA_MOUNT));

  /* Anything else is answered without touching the filesystem at all. */
  EXPECT(answering("THAW\n", true) == GUEST_CONTROL_IGNORED);
  EXPECT(!guest_control_thaw(DATA_MOUNT) && errno == EINVAL);
  EXPECT(can_write_as_tenant(DATA_MOUNT));

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
