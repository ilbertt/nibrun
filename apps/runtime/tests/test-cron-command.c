#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#include "../src/cron-command.h"
#include "../src/paths.h"
#include "../src/supervise.h"
#include "expect.h"

#define COMMAND_EXIT_CODE 7

static struct instance_config config(void) {
  return (struct instance_config){.port = 8080,
                                 .tenant_variable_count = 2,
                                 .tenant_environment = {"TOKEN=instance-secret", "LITERAL=instance"}};
}

static void test_identity_and_environment(void) {
  struct instance_config instance = config();
  char *overrides[] = {"LITERAL=$unexpanded 'quoted' héllo", "NEW=added"};
  FILE *output = tmpfile();
  FILE *errors = tmpfile();
  struct cron_command command = {
      .config = &instance,
      .command = "printf '%s|%s|%s|%s|%s|%s\\n' \"$TOKEN\" \"$LITERAL\" \"$NEW\" \"$PORT\" \"$HOME\" \"$NIBRUN_DATA_DIR\"; "
                 "pwd; id -u; id -g; id -G; printf 'error output\\n' >&2; "
                 "IFS= read -r input && exit 99; exit 7",
      .environment = overrides,
      .environment_count = sizeof(overrides) / sizeof(overrides[0]),
      .output = fileno(output),
      .errors = fileno(errors),
  };
  supervise_block_signals();
  pid_t process = cron_command_start(&command);
  EXPECT(process > 0);
  int status;
  EXPECT(waitpid(process, &status, 0) == process);
  EXPECT(WIFEXITED(status) && WEXITSTATUS(status) == COMMAND_EXIT_CODE);
  rewind(output);
  char bytes[1024] = {0};
  size_t length = fread(bytes, 1, sizeof(bytes) - 1, output);
  EXPECT(length > 0);
  EXPECT(strcmp(bytes, "instance-secret|$unexpanded 'quoted' héllo|added|8080|/app|/app/data\n"
                       "/app\n65534\n65534\n65534\n") == 0);
  rewind(errors);
  memset(bytes, 0, sizeof(bytes));
  length = fread(bytes, 1, sizeof(bytes) - 1, errors);
  EXPECT(length > 0);
  EXPECT(strcmp(bytes, "error output\n") == 0);
  EXPECT(strcmp(instance.tenant_environment[1], "LITERAL=instance") == 0);
  fclose(output);
  fclose(errors);
}

static void test_overlapping_commands(void) {
  struct instance_config instance = config();
  int first[2];
  int second[2];
  EXPECT(pipe2(first, O_CLOEXEC) == 0);
  EXPECT(pipe2(second, O_CLOEXEC) == 0);
  struct cron_command command = {.config = &instance,
                                 .command = "printf 'ready'; exec sleep 30",
                                 .output = first[1],
                                 .errors = STDERR_FILENO};
  pid_t one = cron_command_start(&command);
  command.output = second[1];
  pid_t two = cron_command_start(&command);
  close(first[1]);
  close(second[1]);
  char bytes[5];
  EXPECT(read(first[0], bytes, sizeof(bytes)) == sizeof(bytes));
  EXPECT(memcmp(bytes, "ready", sizeof(bytes)) == 0);
  EXPECT(read(second[0], bytes, sizeof(bytes)) == sizeof(bytes));
  EXPECT(memcmp(bytes, "ready", sizeof(bytes)) == 0);
  EXPECT(one > 0 && two > 0 && one != two);
  EXPECT(getpgid(one) == one);
  EXPECT(getpgid(two) == two);
  EXPECT(kill(-one, SIGKILL) == 0);
  int status;
  EXPECT(waitpid(one, &status, 0) == one);
  EXPECT(WIFSIGNALED(status) && WTERMSIG(status) == SIGKILL);
  EXPECT(kill(two, 0) == 0);
  EXPECT(kill(-two, SIGKILL) == 0);
  EXPECT(waitpid(two, &status, 0) == two);
  close(first[0]);
  close(second[0]);
}

static void test_shell_override(void) {
  struct instance_config instance = config();
  char *overrides[] = {"SHELL=/bin/dash"};
  FILE *output = tmpfile();
  struct cron_command command = {.config = &instance,
                                 .command = "printf '%s' \"$0\"",
                                 .environment = overrides,
                                 .environment_count = 1,
                                 .output = fileno(output),
                                 .errors = STDERR_FILENO};
  pid_t process = cron_command_start(&command);
  EXPECT(process > 0);
  int status;
  EXPECT(waitpid(process, &status, 0) == process);
  EXPECT(WIFEXITED(status) && WEXITSTATUS(status) == 0);
  rewind(output);
  char bytes[32] = {0};
  EXPECT(fread(bytes, 1, sizeof(bytes) - 1, output) > 0);
  EXPECT(strcmp(bytes, "/bin/dash") == 0);
  fclose(output);
}

static void test_invalid_command_does_not_spawn(void) {
  struct instance_config instance = config();
  char *invalid[] = {"MISSING_EQUALS"};
  struct cron_command command = {.config = &instance,
                                 .command = "exit 0",
                                 .environment = invalid,
                                 .environment_count = 1,
                                 .output = STDOUT_FILENO,
                                 .errors = STDERR_FILENO};
  EXPECT(cron_command_start(&command) == -1 && errno == EINVAL);
  command.environment_count = CRON_MAX_ENVIRONMENT_VARIABLES + 1;
  EXPECT(cron_command_start(&command) == -1 && errno == EINVAL);
  command.environment_count = 0;
  command.command = "";
  EXPECT(cron_command_start(&command) == -1 && errno == EINVAL);
  char oversized[CRON_MAX_COMMAND_BYTES + 2];
  memset(oversized, 'x', sizeof(oversized) - 1);
  oversized[sizeof(oversized) - 1] = '\0';
  command.command = oversized;
  EXPECT(cron_command_start(&command) == -1 && errno == EINVAL);
}

int main(void) {
  alarm(15);
  EXPECT(mkdir(APP_DIR, 0755) == 0 || errno == EEXIST);
  test_identity_and_environment();
  test_overlapping_commands();
  test_shell_override();
  test_invalid_command_does_not_spawn();
  return EXPECT_REPORT("cron-command");
}
