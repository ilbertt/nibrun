/* Stands in for a tenant binary. Everything it does is chosen by environment
 * variables rather than arguments, because the environment is exactly what the
 * runtime hands a tenant — the supervisor execs it with argv[0] and nothing else. */

#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define USAGE_EXIT_CODE 64
#define UNWRITABLE_EXIT_CODE 65
#define CRASH_EXIT_CODE 7

static const char *marker_path;

static void append(const char *path, const char *text) {
  int descriptor = open(path, O_WRONLY | O_CREAT | O_APPEND, 0666);
  if (descriptor < 0) {
    _exit(UNWRITABLE_EXIT_CODE);
  }
  if (write(descriptor, text, strlen(text)) < 0) {
    _exit(UNWRITABLE_EXIT_CODE);
  }
  close(descriptor);
}

static void append_pid(const char *path) {
  char line[32];
  snprintf(line, sizeof(line), "%d\n", (int)getpid());
  append(path, line);
}

static void report(const char *record) {
  char directory[128];
  if (getcwd(directory, sizeof(directory)) == NULL) {
    _exit(UNWRITABLE_EXIT_CODE);
  }
  const char *port = getenv("NIBRUN_HTTP_PORT");
  const char *port_alias = getenv("PORT");
  const char *hostname = getenv("NIBRUN_HOSTNAME");
  const char *home = getenv("HOME");
  const char *data_dir = getenv("NIBRUN_DATA_DIR");
  char line[512];
  snprintf(line, sizeof(line),
           "NIBRUN_HTTP_PORT=%s PORT=%s NIBRUN_HOSTNAME=%s NIBRUN_DATA_DIR=%s HOME=%s CWD=%s "
           "UID=%d GID=%d\n",
           port == NULL ? "" : port, port_alias == NULL ? "" : port_alias,
           hostname == NULL ? "" : hostname, data_dir == NULL ? "" : data_dir,
           home == NULL ? "" : home, directory, (int)getuid(), (int)getgid());
  append(record, line);
}

static void sleep_ms(long duration_ms) {
  struct timespec remaining = {duration_ms / 1000, (duration_ms % 1000) * 1000000L};
  nanosleep(&remaining, NULL);
}

static void on_term(int signal_number) {
  (void)signal_number;
  append(marker_path, "term\n");
  _exit(0);
}

static _Noreturn void wait_forever(void) {
  for (;;) {
    pause();
  }
}

static long number_from(const char *name) {
  const char *value = getenv(name);
  return value == NULL ? 0 : atol(value);
}

int main(void) {
  const char *mode = getenv("FAKE_MODE");
  const char *record = getenv("FAKE_RECORD");
  if (mode == NULL || record == NULL) {
    return USAGE_EXIT_CODE;
  }

  if (strcmp(mode, "crash") == 0) {
    append_pid(record);
    return CRASH_EXIT_CODE;
  }
  if (strcmp(mode, "stay") == 0) {
    append_pid(record);
    sleep_ms(number_from("FAKE_DURATION_MS"));
    return CRASH_EXIT_CODE;
  }
  if (strcmp(mode, "catch-term") == 0) {
    marker_path = record;
    signal(SIGTERM, on_term);
    append(record, "started\n");
    wait_forever();
  }
  if (strcmp(mode, "ignore-term") == 0) {
    signal(SIGTERM, SIG_IGN);
    append_pid(record);
    wait_forever();
  }
  /* Leaves a process behind that outlives it, which PID 1 has to reap. */
  if (strcmp(mode, "orphan") == 0) {
    pid_t child = fork();
    if (child < 0) {
      return UNWRITABLE_EXIT_CODE;
    }
    if (child == 0) {
      sleep_ms(number_from("FAKE_DURATION_MS"));
      _exit(0);
    }
    char line[32];
    snprintf(line, sizeof(line), "%d\n", (int)child);
    append(record, line);
    return 0;
  }
  /* Reports what the runtime handed it and then behaves like a server: stays up,
   * and stops when asked. What a boot test needs from a tenant. */
  if (strcmp(mode, "serve") == 0) {
    marker_path = record;
    signal(SIGTERM, on_term);
    report(record);
    wait_forever();
  }
  /* Reports what the runtime handed it, so the tenant's side of the contract can
   * be asserted rather than assumed. */
  if (strcmp(mode, "report-environment") == 0) {
    report(record);
    return 0;
  }
  if (strcmp(mode, "write-output") == 0) {
    fputs("from stdout\n", stdout);
    fputs("from stderr\n", stderr);
    return 0;
  }
  return USAGE_EXIT_CODE;
}
