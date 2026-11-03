#include "clock.h"
#include "guest-sqlite.h"
#include "log.h"
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#define STOCK_INIT "/usr/lib/nibrun/nibrunner-init"
#define SQLITE_CGROUP "/sys/fs/cgroup/nibrun-sqlite"
#define CGROUP_READY "/sys/fs/cgroup/tenant/memory.max"
#define NIBRUNNER_DATA_DIRECTORY "/mnt/root/app/data"
#define SQLITE_MEMORY_BYTES (24 * 1024 * 1024)
#define BOOT_TIMEOUT_MS 30000
#define BOOT_POLL_US 10000

static bool write_setting(const char *path, const char *value) {
  int file = open(path, O_WRONLY | O_CLOEXEC);
  if (file < 0)
    return false;
  size_t length = 0;
  while (value[length] != 0)
    length++;
  bool written = write(file, value, length) == (ssize_t)length;
  close(file);
  return written;
}

static bool reader_budget(void) {
  uint64_t deadline = clock_monotonic_ms() + BOOT_TIMEOUT_MS;
  while (access(CGROUP_READY, F_OK) != 0) {
    if (clock_remaining_ms(deadline) == 0)
      return false;
    usleep(BOOT_POLL_US);
  }
  if (mkdir(SQLITE_CGROUP, 0755) < 0 && errno != EEXIST)
    return false;
  char memory[32];
  snprintf(memory, sizeof(memory), "%d", SQLITE_MEMORY_BYTES);
  char process[32];
  snprintf(process, sizeof(process), "%ld", (long)getpid());
  return write_setting(SQLITE_CGROUP "/memory.max", memory) &&
         write_setting(SQLITE_CGROUP "/memory.swap.max", "0") &&
         write_setting(SQLITE_CGROUP "/memory.oom.group", "0") &&
         write_setting("/proc/self/oom_score_adj", "1000") &&
         write_setting(SQLITE_CGROUP "/cgroup.procs", process) &&
         setpriority(PRIO_PROCESS, 0, 19) == 0;
}

static void sqlite_reader(pid_t parent) {
  if (prctl(PR_SET_PDEATHSIG, SIGTERM) < 0 || getppid() != parent ||
      !reader_budget()) {
    log_errno("could not reserve memory for the SQLite reader");
    _exit(1);
  }
  int console = open("/dev/console", O_WRONLY | O_CLOEXEC);
  if (console >= 0) {
    dup2(console, STDOUT_FILENO);
    dup2(console, STDERR_FILENO);
    if (console > STDERR_FILENO)
      close(console);
  }
  struct guest_sqlite reader = {.mount_point = NIBRUNNER_DATA_DIRECTORY};
  guest_sqlite_start(&reader);
  if (reader.process > 0) {
    while (waitpid(reader.process, NULL, 0) < 0 && errno == EINTR) {
    }
  }
  _exit(0);
}

int main(int argc, char **argv) {
  (void)argc;
  if (getpid() == 1) {
    pid_t process = fork();
    if (process == 0)
      sqlite_reader(1);
    if (process < 0)
      log_errno("could not start the SQLite reader");
  }
  execv(STOCK_INIT, argv);
  log_errno("could not execute the stock nibrunner init");
  return EXIT_FAILURE;
}
