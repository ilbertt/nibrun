#ifndef NIBRUN_LOG_H
#define NIBRUN_LOG_H

/* The tenant's stdout and the runtime's own messages share one console, so every
 * line the runtime writes carries a prefix the tenant's output does not, and is
 * written whole rather than in pieces that could interleave. */

void log_line(const char *format, ...) __attribute__((format(printf, 1, 2)));

/* Same, with ": <strerror(errno)>" appended. */
void log_errno(const char *format, ...) __attribute__((format(printf, 1, 2)));

#endif
