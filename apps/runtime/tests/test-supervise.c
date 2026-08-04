/* Runs the real supervisor against a stand-in tenant. Only the mount sequence needs
 * a kernel of its own; forking, dropping privileges, backing off, reaping and
 * forwarding a shutdown are all exercised here for real. */

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#include "../src/paths.h"
#include "../src/supervise.h"
#include "expect.h"

#define FAKE_TENANT "/fake-tenant"
#define SCRATCH_DIR "/tmp"
#define POLL_INTERVAL_MS 10
#define GENEROUS_TIMEOUT_MS 10000

static uint64_t monotonic_ms(void) {
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  return (uint64_t)now.tv_sec * 1000 + (uint64_t)now.tv_nsec / 1000000;
}

static void sleep_ms(long duration_ms) {
  nanosleep(&(struct timespec){duration_ms / 1000, (duration_ms % 1000) * 1000000L}, NULL);
}

static const char *scratch_file(const char *name) {
  static char path[128];
  snprintf(path, sizeof(path), SCRATCH_DIR "/%s", name);
  unlink(path);
  /* The tenant writes it as an unprivileged uid, so it cannot be root's to create. */
  int descriptor = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0666);
  if (descriptor >= 0) {
    fchmod(descriptor, 0666);
    close(descriptor);
  }
  return path;
}

static size_t count_lines(const char *path) {
  FILE *file = fopen(path, "r");
  if (file == NULL) {
    return 0;
  }
  size_t lines = 0;
  int character;
  while ((character = fgetc(file)) != EOF) {
    lines += character == '\n';
  }
  fclose(file);
  return lines;
}

static bool file_contains(const char *path, const char *needle) {
  char contents[1024] = {0};
  int descriptor = open(path, O_RDONLY);
  if (descriptor < 0) {
    return false;
  }
  ssize_t length = read(descriptor, contents, sizeof(contents) - 1);
  close(descriptor);
  return length > 0 && strstr(contents, needle) != NULL;
}

static bool wait_until_contains(const char *path, const char *needle) {
  for (uint32_t waited = 0; waited < GENEROUS_TIMEOUT_MS; waited += POLL_INTERVAL_MS) {
    if (file_contains(path, needle)) {
      return true;
    }
    sleep_ms(POLL_INTERVAL_MS);
  }
  return false;
}

static pid_t first_pid_in(const char *path) {
  FILE *file = fopen(path, "r");
  if (file == NULL) {
    return -1;
  }
  int pid = -1;
  if (fscanf(file, "%d", &pid) != 1) {
    pid = -1;
  }
  fclose(file);
  return pid;
}

static bool process_exists(pid_t pid) {
  return kill(pid, 0) == 0 || errno == EPERM;
}

/* The supervisor runs in a child so the test can signal it and read its outcome
 * from the exit status. PR_SET_CHILD_SUBREAPER makes it inherit orphans the way
 * PID 1 does inside the guest. */
static pid_t start_supervisor(const struct supervisor *supervisor) {
  pid_t child = fork();
  if (child == 0) {
    prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0);
    supervise_block_signals();
    _exit((int)supervise(supervisor));
  }
  return child;
}

static int wait_for_supervisor(pid_t supervisor) {
  int status = 0;
  while (waitpid(supervisor, &status, 0) < 0 && errno == EINTR) {
  }
  return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
}

static struct supervisor supervisor_for(char *const *environment, const struct restart_policy *policy,
                                        uint32_t grace_ms) {
  return (struct supervisor){
      .tenant =
          {
              .executable = FAKE_TENANT,
              .working_directory = SCRATCH_DIR,
              .environment = environment,
              .uid = TENANT_UID,
              .gid = TENANT_GID,
          },
      .policy = *policy,
      .shutdown_grace_ms = grace_ms,
  };
}

struct captured_output {
  const char *stdout_path;
  const char *stderr_path;
};

static void capture_output(void *context, enum tenant_output_stream stream, const unsigned char *bytes,
                           size_t length) {
  const struct captured_output *captured = context;
  const char *path = stream == TENANT_OUTPUT_STDOUT ? captured->stdout_path : captured->stderr_path;
  int descriptor = open(path, O_WRONLY | O_APPEND);
  if (descriptor < 0 || write(descriptor, bytes, length) != (ssize_t)length) {
    _exit(1);
  }
  close(descriptor);
}

static void backoff_grows_then_stops_growing(void) {
  struct restart_policy policy = {
      .max_restarts = 5, .initial_backoff_ms = 500, .max_backoff_ms = 30000, .backoff_factor = 2,
      .reset_after_ms = 60000};

  EXPECT(supervise_backoff_ms(&policy, 0) == 500);
  EXPECT(supervise_backoff_ms(&policy, 1) == 1000);
  EXPECT(supervise_backoff_ms(&policy, 2) == 2000);
  EXPECT(supervise_backoff_ms(&policy, 6) == 30000);
  EXPECT(supervise_backoff_ms(&policy, 1000000) == 30000);

  policy.backoff_factor = 1;
  EXPECT(supervise_backoff_ms(&policy, 10) == 500);

  policy.backoff_factor = 1.5;
  EXPECT(supervise_backoff_ms(&policy, 2) == 1125);

  policy.initial_backoff_ms = 0;
  EXPECT(supervise_backoff_ms(&policy, 3) == 0);

  policy.initial_backoff_ms = 90000;
  EXPECT(supervise_backoff_ms(&policy, 0) == 30000);
}

static void a_crashing_tenant_exhausts_its_budget(void) {
  const char *record = scratch_file("crash-record");
  char record_variable[160];
  snprintf(record_variable, sizeof(record_variable), "FAKE_RECORD=%s", record);
  char *environment[] = {"FAKE_MODE=crash", record_variable, NULL};

  struct restart_policy policy = {
      .max_restarts = 3, .initial_backoff_ms = 20, .max_backoff_ms = 80, .backoff_factor = 2,
      .reset_after_ms = 60000};
  struct supervisor supervisor = supervisor_for(environment, &policy, 1000);

  uint64_t started = monotonic_ms();
  int outcome = wait_for_supervisor(start_supervisor(&supervisor));
  uint64_t elapsed = monotonic_ms() - started;

  EXPECT(outcome == SUPERVISE_RESTART_BUDGET_EXHAUSTED);
  EXPECT(count_lines(record) == 4); /* the first start plus three restarts */
  EXPECT(elapsed >= 20 + 40 + 80);
}

/* A tenant that keeps staying up for longer than resetAfterMs must never run out of
 * restarts, however many times it eventually dies. */
static void a_tenant_that_stays_up_gets_its_budget_back(void) {
  const char *record = scratch_file("stay-record");
  char record_variable[160];
  snprintf(record_variable, sizeof(record_variable), "FAKE_RECORD=%s", record);
  char *environment[] = {"FAKE_MODE=stay", record_variable, "FAKE_DURATION_MS=200", NULL};

  struct restart_policy policy = {
      .max_restarts = 1, .initial_backoff_ms = 10, .max_backoff_ms = 10, .backoff_factor = 2,
      .reset_after_ms = 150};
  struct supervisor supervisor = supervisor_for(environment, &policy, 1000);

  pid_t process = start_supervisor(&supervisor);
  sleep_ms(1400);
  kill(process, SIGTERM);
  int outcome = wait_for_supervisor(process);

  EXPECT(outcome == SUPERVISE_SHUTDOWN_REQUESTED);
  /* Without the reset this policy allows two starts in total. */
  EXPECT(count_lines(record) > 2);
}

static void a_shutdown_reaches_the_tenant(void) {
  const char *record = scratch_file("term-record");
  char record_variable[160];
  snprintf(record_variable, sizeof(record_variable), "FAKE_RECORD=%s", record);
  char *environment[] = {"FAKE_MODE=catch-term", record_variable, NULL};

  struct restart_policy policy = {
      .max_restarts = 5, .initial_backoff_ms = 10, .max_backoff_ms = 10, .backoff_factor = 2,
      .reset_after_ms = 60000};
  struct supervisor supervisor = supervisor_for(environment, &policy, 5000);

  pid_t process = start_supervisor(&supervisor);
  EXPECT(wait_until_contains(record, "started"));

  uint64_t started = monotonic_ms();
  kill(process, SIGTERM);
  int outcome = wait_for_supervisor(process);
  uint64_t elapsed = monotonic_ms() - started;

  EXPECT(outcome == SUPERVISE_SHUTDOWN_REQUESTED);
  EXPECT(file_contains(record, "term"));
  EXPECT(elapsed < 5000); /* it stopped because it was asked to, not because it was killed */
}

/* Ctrl-alt-del arrives as a signal to PID 1; a tenant that ignores SIGTERM must not
 * be able to hold the microVM open past its grace period. */
static void a_tenant_that_ignores_sigterm_is_killed(void) {
  const char *record = scratch_file("ignore-record");
  char record_variable[160];
  snprintf(record_variable, sizeof(record_variable), "FAKE_RECORD=%s", record);
  char *environment[] = {"FAKE_MODE=ignore-term", record_variable, NULL};

  struct restart_policy policy = {
      .max_restarts = 5, .initial_backoff_ms = 10, .max_backoff_ms = 10, .backoff_factor = 2,
      .reset_after_ms = 60000};
  struct supervisor supervisor = supervisor_for(environment, &policy, 300);

  pid_t process = start_supervisor(&supervisor);
  EXPECT(wait_until_contains(record, "\n"));
  pid_t tenant = first_pid_in(record);

  uint64_t started = monotonic_ms();
  kill(process, SIGTERM);
  int outcome = wait_for_supervisor(process);
  uint64_t elapsed = monotonic_ms() - started;

  EXPECT(outcome == SUPERVISE_SHUTDOWN_REQUESTED);
  EXPECT(elapsed >= 300);
  EXPECT(elapsed < 5000);
  EXPECT(tenant > 0 && !process_exists(tenant));
}

/* Whatever the tenant leaves behind becomes PID 1's to bury. An unreaped child stays
 * a zombie for as long as the supervisor lives. */
static void orphans_are_reaped(void) {
  const char *record = scratch_file("orphan-record");
  char record_variable[160];
  snprintf(record_variable, sizeof(record_variable), "FAKE_RECORD=%s", record);
  char *environment[] = {"FAKE_MODE=orphan", record_variable, "FAKE_DURATION_MS=300", NULL};

  struct restart_policy policy = {
      .max_restarts = 5, .initial_backoff_ms = 3000, .max_backoff_ms = 3000, .backoff_factor = 1,
      .reset_after_ms = 60000};
  struct supervisor supervisor = supervisor_for(environment, &policy, 1000);

  pid_t process = start_supervisor(&supervisor);
  EXPECT(wait_until_contains(record, "\n"));
  pid_t orphan = first_pid_in(record);
  EXPECT(orphan > 0);

  sleep_ms(1200); /* the orphan is long gone, the supervisor is still backing off */
  bool reaped = !process_exists(orphan);

  kill(process, SIGTERM);
  EXPECT(wait_for_supervisor(process) == SUPERVISE_SHUTDOWN_REQUESTED);
  EXPECT(reaped);
}

static void the_tenant_runs_unprivileged_in_its_own_directory(void) {
  const char *record = scratch_file("environment-record");
  char record_variable[160];
  snprintf(record_variable, sizeof(record_variable), "FAKE_RECORD=%s", record);
  char *environment[] = {"FAKE_MODE=report-environment", record_variable, "PORT=8080",
                         "HOME=" APP_DIR, NULL};

  struct restart_policy policy = {
      .max_restarts = 0, .initial_backoff_ms = 0, .max_backoff_ms = 0, .backoff_factor = 1,
      .reset_after_ms = 60000};
  struct supervisor supervisor = supervisor_for(environment, &policy, 1000);

  EXPECT(wait_for_supervisor(start_supervisor(&supervisor)) == SUPERVISE_RESTART_BUDGET_EXHAUSTED);
  EXPECT(file_contains(record, "PORT=8080"));
  EXPECT(file_contains(record, "HOME=" APP_DIR));
  EXPECT(file_contains(record, "CWD=" SCRATCH_DIR));
  EXPECT(file_contains(record, "UID=65534"));
  EXPECT(file_contains(record, "GID=65534"));
}

static void stdout_and_stderr_are_separate_streams(void) {
  char stdout_path[128];
  char stderr_path[128];
  snprintf(stdout_path, sizeof(stdout_path), "%s", scratch_file("stdout-record"));
  snprintf(stderr_path, sizeof(stderr_path), "%s", scratch_file("stderr-record"));
  struct captured_output captured = {.stdout_path = stdout_path, .stderr_path = stderr_path};
  char *environment[] = {"FAKE_MODE=write-output", "FAKE_RECORD=/tmp/unused", NULL};
  struct restart_policy policy = {
      .max_restarts = 0, .initial_backoff_ms = 0, .max_backoff_ms = 0, .backoff_factor = 1,
      .reset_after_ms = 60000};
  struct supervisor supervisor = supervisor_for(environment, &policy, 1000);
  supervisor.output = (struct tenant_output){.write = capture_output, .context = &captured};

  EXPECT(wait_for_supervisor(start_supervisor(&supervisor)) == SUPERVISE_RESTART_BUDGET_EXHAUSTED);
  EXPECT(file_contains(stdout_path, "from stdout\n"));
  EXPECT(!file_contains(stdout_path, "from stderr\n"));
  EXPECT(file_contains(stderr_path, "from stderr\n"));
  EXPECT(!file_contains(stderr_path, "from stdout\n"));
}

static void count_service(void *context) {
  int descriptor = open((const char *)context, O_WRONLY | O_APPEND);
  if (descriptor < 0 || write(descriptor, "x", 1) != 1) {
    _exit(1);
  }
  close(descriptor);
}

/* A tenant that prints nothing is the whole problem: it is the one case where no write can
 * discover that the sink's far end has gone, so the supervisor has to hand it a turn unasked. */
static void a_quiet_tenant_still_gets_the_sink_serviced(void) {
  char ticks_path[128];
  snprintf(ticks_path, sizeof(ticks_path), "%s", scratch_file("service-ticks"));
  char *environment[] = {"FAKE_MODE=stay", "FAKE_RECORD=/tmp/unused", "FAKE_DURATION_MS=3500",
                         NULL};
  struct restart_policy policy = {
      .max_restarts = 0, .initial_backoff_ms = 0, .max_backoff_ms = 0, .backoff_factor = 1,
      .reset_after_ms = 60000};
  struct supervisor supervisor = supervisor_for(environment, &policy, 1000);
  supervisor.output = (struct tenant_output){.service = count_service, .context = ticks_path};

  EXPECT(wait_for_supervisor(start_supervisor(&supervisor)) == SUPERVISE_RESTART_BUDGET_EXHAUSTED);
  EXPECT(file_contains(ticks_path, "xx"));
}

int main(void) {
  backoff_grows_then_stops_growing();
  a_crashing_tenant_exhausts_its_budget();
  a_tenant_that_stays_up_gets_its_budget_back();
  a_shutdown_reaches_the_tenant();
  a_tenant_that_ignores_sigterm_is_killed();
  orphans_are_reaped();
  the_tenant_runs_unprivileged_in_its_own_directory();
  stdout_and_stderr_are_separate_streams();
  a_quiet_tenant_still_gets_the_sink_serviced();
  return EXPECT_REPORT("supervise");
}
