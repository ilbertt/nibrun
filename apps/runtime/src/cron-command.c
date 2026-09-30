#include "cron-command.h"

#include <errno.h>
#include <fcntl.h>
#include <stdbool.h>
#include <string.h>
#include <unistd.h>

#include "paths.h"
#include "tenant-process.h"

struct environment_merge {
  const struct cron_command *command;
  char **into;
};

static void build_cron_environment(const struct environment_merge *merge) {
  char *const *base = config_build_environment(merge->command->config);
  size_t count = 0;
  for (; base[count] != NULL; count++) {
    merge->into[count] = base[count];
  }
  for (size_t index = 0; index < merge->command->environment_count; index++) {
    char *override = merge->command->environment[index];
    size_t name_length = (size_t)(strchr(override, '=') - override) + 1;
    size_t position = 0;
    while (position < count && strncmp(merge->into[position], override, name_length) != 0) {
      position++;
    }
    merge->into[position] = override;
    if (position == count) {
      count++;
    }
  }
  merge->into[count] = NULL;
}

static const char *command_shell(char *const *environment) {
  for (size_t index = 0; environment[index] != NULL; index++) {
    if (strncmp(environment[index], "SHELL=", sizeof("SHELL=") - 1) == 0) {
      return environment[index] + sizeof("SHELL=") - 1;
    }
  }
  return "/bin/sh";
}

static bool valid_command(const struct cron_command *command) {
  if (command->config == NULL || command->command == NULL || command->command[0] == '\0' ||
      strnlen(command->command, CRON_MAX_COMMAND_BYTES + 1) > CRON_MAX_COMMAND_BYTES ||
      command->environment_count > CRON_MAX_ENVIRONMENT_VARIABLES ||
      (command->environment_count > 0 && command->environment == NULL)) {
    return false;
  }
  for (size_t index = 0; index < command->environment_count; index++) {
    const char *entry = command->environment[index];
    if (entry == NULL || entry[0] == '=' || strchr(entry, '=') == NULL) {
      return false;
    }
  }
  return true;
}

pid_t cron_command_start(const struct cron_command *command) {
  if (!valid_command(command)) {
    errno = EINVAL;
    return -1;
  }
  int input = open("/dev/null", O_RDONLY | O_CLOEXEC);
  if (input < 0) {
    return -1;
  }
  pid_t process = fork();
  if (process == 0) {
    char *environment[CONFIG_MAX_ENVIRONMENT_VARIABLES + CRON_MAX_ENVIRONMENT_VARIABLES + 1];
    struct environment_merge merge = {.command = command, .into = environment};
    build_cron_environment(&merge);
    const char *shell = command_shell(environment);
    char *arguments[] = {(char *)shell, "-c", (char *)command->command, NULL};
    struct tenant_process tenant = {.executable = shell,
                                   .working_directory = APP_DIR,
                                   .argv = arguments,
                                   .environment = environment,
                                   .uid = TENANT_UID,
                                   .gid = TENANT_GID};
    struct tenant_launch launch = {
        .tenant = &tenant, .input = input, .output = command->output, .errors = command->errors};
    tenant_process_exec(&launch);
  }
  close(input);
  return process;
}
