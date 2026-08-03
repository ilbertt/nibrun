#include "log.h"

#include <errno.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#define LOG_PREFIX "[nibrun] "
#define LOG_LINE_MAX 512

static size_t clamp(int written, size_t used, size_t limit) {
  if (written < 0) {
    return used;
  }
  size_t total = used + (size_t)written;
  return total > limit ? limit : total;
}

static void emit(int error_number, const char *format, va_list arguments) {
  char line[LOG_LINE_MAX];
  const size_t limit = sizeof(line) - 1; /* the newline is written into the byte this leaves */
  size_t used = 0;

  used = clamp(snprintf(line, limit + 1, "%s", LOG_PREFIX), used, limit);
  used = clamp(vsnprintf(line + used, limit + 1 - used, format, arguments), used, limit);
  if (error_number != 0) {
    used = clamp(snprintf(line + used, limit + 1 - used, ": %s", strerror(error_number)), used, limit);
  }

  line[used] = '\n';
  if (write(STDERR_FILENO, line, used + 1) < 0) {
    /* The console is the only sink there is; a failure here has nowhere to go. */
  }
}

void log_line(const char *format, ...) {
  va_list arguments;
  va_start(arguments, format);
  emit(0, format, arguments);
  va_end(arguments);
}

void log_errno(const char *format, ...) {
  int error_number = errno;
  va_list arguments;
  va_start(arguments, format);
  emit(error_number, format, arguments);
  va_end(arguments);
}
