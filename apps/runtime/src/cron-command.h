#ifndef NIBRUN_CRON_COMMAND_H
#define NIBRUN_CRON_COMMAND_H

#include <sys/types.h>

#include "config.h"

/* The protocol bounds characters; UTF-8 may need four bytes for each. */
#define CRON_MAX_COMMAND_BYTES (4096 * 4)
#define CRON_MAX_ENVIRONMENT_VARIABLES 256

struct cron_command {
  const struct instance_config *config;
  const char *command;
  char *const *environment;
  size_t environment_count;
  int output;
  int errors;
};

pid_t cron_command_start(const struct cron_command *command);

#endif
