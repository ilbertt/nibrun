#ifndef NIBRUN_SQLITE_DATABASE_H
#define NIBRUN_SQLITE_DATABASE_H
#include <signal.h>
#include <sqlite3.h>
#include <stdbool.h>
#include <stdint.h>
#define SQLITE_REQUEST_MAX_BYTES 65536
#define SQLITE_RESPONSE_MAX_BYTES (4 * 1024 * 1024)
#define SQLITE_QUERY_TIMEOUT_MS 5000
struct sqlite_query {
  sqlite3 *database;
  int connection;
  uint64_t deadline_ms;
  volatile sig_atomic_t *stopping;
};
/* Workers must chroot to the data filesystem and drop privileges before opening. */
int sqlite_query_open(struct sqlite_query *query, const char *path);
#endif
