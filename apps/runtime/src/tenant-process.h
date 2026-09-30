#ifndef NIBRUN_TENANT_PROCESS_H
#define NIBRUN_TENANT_PROCESS_H

#include <sys/types.h>

struct tenant_process {
  const char *executable;
  const char *working_directory;
  /* argv as execve wants it, the binary itself included. */
  char *const *argv;
  char *const *environment;
  uid_t uid;
  gid_t gid;
};

struct tenant_launch {
  const struct tenant_process *tenant;
  int input;
  int output;
  int errors;
};

_Noreturn void tenant_process_exec(const struct tenant_launch *launch);

#endif
