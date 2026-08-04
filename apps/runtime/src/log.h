#ifndef NIBRUN_LOG_H
#define NIBRUN_LOG_H

/* Runtime diagnostics stay on the guest console and carry a prefix that keeps
 * them distinct from the tenant output shipped over vsock. */

void log_line(const char *format, ...) __attribute__((format(printf, 1, 2)));

/* Same, with ": <strerror(errno)>" appended. */
void log_errno(const char *format, ...) __attribute__((format(printf, 1, 2)));

#endif
