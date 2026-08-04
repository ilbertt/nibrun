/* nibrun's guest PID 1.
 *
 * Boots one tenant binary inside one Firecracker microVM: mounts what the guest
 * needs, reads the instance config off its own drive, gives the tenant its data
 * filesystem at data/, drops privileges, and supervises it until it is asked to
 * stop or has run out of restarts. Nothing else runs in this VM. */

#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <stdio.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/reboot.h>
#include <sys/stat.h>
#include <unistd.h>

#include "config.h"
#include "guest-logs.h"
#include "log.h"
#include "mounts.h"
#include "paths.h"
#include "supervise.h"

/* What the tenant gets between SIGTERM and SIGKILL. The agent's own wait for the
 * microVM to exit has to be longer than this, or a tenant that takes its time
 * shutting down looks the same as one that hung. */
#define SHUTDOWN_GRACE_MS 10000
#define TENANT_UMASK 0022

static _Noreturn void shutdown_guest(void) {
  /* Unmounted rather than only synced, so the next boot finds a clean filesystem
   * instead of replaying a journal. */
  if (umount(DATA_DIR) < 0 && errno != EINVAL && errno != ENOENT) {
    log_errno("could not unmount %s", DATA_DIR);
  }
  sync();
  /* A guest reset is what Firecracker turns into "the microVM exited". Powering
   * off or halting instead leaves the VMM process running with nobody inside it,
   * and the agent would never see the instance stop. */
  reboot(RB_AUTOBOOT);
  log_errno("the guest could not be shut down");
  for (;;) {
    pause();
  }
}

/* The rootfs image carries no device nodes of its own, so whether init starts with
 * a stdin, stdout and stderr at all depends on the kernel having mounted devtmpfs
 * before executing it. Claiming the console here gives runtime diagnostics a
 * reliable sink; tenant output gets its own descriptors when it is spawned. */
static void adopt_console(void) {
  int console = open("/dev/console", O_RDWR | O_NOCTTY);
  if (console < 0) {
    return;
  }
  for (int target = STDIN_FILENO; target <= STDERR_FILENO; target++) {
    if (console != target) {
      dup2(console, target);
    }
  }
  if (console > STDERR_FILENO) {
    close(console);
  }
}

/* Firecracker's SendCtrlAltDel arrives as a key sequence, and the kernel's default
 * response is to reset the machine on the spot — which ends the VM with the tenant
 * mid-write. Disabling it turns the same sequence into a SIGINT to PID 1, which is
 * the only way the guest ever hears "please stop". */
static void route_ctrl_alt_del_to_this_process(void) {
  if (reboot(RB_DISABLE_CAD) < 0) {
    log_errno("could not take over ctrl-alt-del");
  }
}

static bool write_resolv_conf(const struct instance_config *config) {
  if (config->nameserver_count == 0) {
    log_line("instance.env names no DNS server, so the tenant will not resolve hostnames");
  }
  int descriptor = open(RESOLV_CONF, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644);
  if (descriptor < 0) {
    log_errno("could not write %s", RESOLV_CONF);
    return false;
  }
  for (size_t index = 0; index < config->nameserver_count; index++) {
    char line[sizeof("nameserver ") + INET6_ADDRSTRLEN + 1];
    int length = snprintf(line, sizeof(line), "nameserver %s\n", config->nameservers[index]);
    if (write(descriptor, line, (size_t)length) != length) {
      log_errno("could not write %s", RESOLV_CONF);
      close(descriptor);
      return false;
    }
  }
  close(descriptor);
  return true;
}

static bool prepare_tenant_filesystem(void) {
  if (!mounts_artifact(ARTIFACT_DEVICE, ARTIFACT_MOUNT)) {
    return false;
  }
  /* Checked here rather than left to execve, which would spend the whole restart
   * budget on the same EACCES. The tenant runs as an unprivileged uid, so a binary
   * the artifact builder wrote without world-execute cannot be started at all. */
  struct stat details;
  if (stat(TENANT_BINARY, &details) < 0 || !S_ISREG(details.st_mode)) {
    log_line("the artifact drive holds no binary at /server");
    return false;
  }
  if ((details.st_mode & S_IXOTH) == 0) {
    log_line("/server on the artifact drive is not executable by the uid it runs as");
    return false;
  }
  /* The tenant's working directory is a tmpfs it does not own: the only path it
   * can write is the data filesystem mounted inside it. */
  if (!mounts_tmpfs(APP_DIR, "mode=0755")) {
    return false;
  }
  return mounts_tenant_data(&(struct tenant_data_mount){
      .device = DATA_DEVICE, .target = DATA_DIR, .uid = TENANT_UID, .gid = TENANT_GID});
}

static bool read_instance_config(struct instance_config *config) {
  static char text[CONFIG_MAX_BYTES];

  if (!mounts_config(CONFIG_DEVICE, CONFIG_MOUNT)) {
    return false;
  }
  if (!config_read_file(config, CONFIG_FILE, text, sizeof(text))) {
    return false;
  }
  /* The config drive carries the tenant's secrets; nothing needs it after this. */
  if (umount(CONFIG_MOUNT) < 0) {
    log_errno("could not unmount %s", CONFIG_MOUNT);
    return false;
  }
  log_line("instance configured: port %u, %zu environment variables, %zu nameservers", config->port,
           config->tenant_variable_count, config->nameserver_count);
  return true;
}

int main(void) {
  umask(TENANT_UMASK);

  if (!mounts_dev()) {
    shutdown_guest(); /* there is no console to say so on */
  }
  adopt_console();
  log_line("guest runtime starting");

  supervise_block_signals();
  route_ctrl_alt_del_to_this_process();

  struct instance_config config;
  if (!mounts_pseudo_filesystems() || !read_instance_config(&config) || !write_resolv_conf(&config) ||
      !prepare_tenant_filesystem()) {
    shutdown_guest();
  }

  struct supervisor supervisor = {
      .tenant =
          {
              .executable = TENANT_BINARY,
              .working_directory = APP_DIR,
              .argv = config_build_argv(&config, TENANT_BINARY),
              .environment = config_build_environment(&config),
              .uid = TENANT_UID,
              .gid = TENANT_GID,
          },
      .output = {0},
      .policy = config.restart_policy,
      .shutdown_grace_ms = SHUTDOWN_GRACE_MS,
  };

  struct guest_log_forwarder guest_logs;
  guest_logs_init(&guest_logs);
  supervisor.output = guest_logs_tenant_output(&guest_logs);

  log_line("starting the tenant as uid %u with data at %s", TENANT_UID, DATA_DIR);
  switch (supervise(&supervisor)) {
    case SUPERVISE_SHUTDOWN_REQUESTED:
      log_line("the tenant has stopped; shutting the guest down");
      break;
    case SUPERVISE_RESTART_BUDGET_EXHAUSTED:
      /* Deliberately not another restart: the guest ends, the agent reports the
       * instance failed, and what happens next is the reconciler's call. A host
       * that retried forever on its own would hide a broken deploy. */
      log_line("the tenant used its %u restarts without staying up; shutting the guest down",
               config.restart_policy.max_restarts);
      break;
    case SUPERVISE_SPAWN_FAILED:
      log_line("the tenant could not be started at all; shutting the guest down");
      break;
  }
  guest_logs_close(&guest_logs);
  shutdown_guest();
}
