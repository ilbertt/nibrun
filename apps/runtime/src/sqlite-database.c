#include "sqlite-database.h"
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>
#include "clock.h"

static sqlite3_vfs jailed_vfs;
static sqlite3_vfs *unix_vfs;

static int open_without_symlinks(sqlite3_vfs *vfs, const char *name, sqlite3_file *file, int flags,
                                 int *actual) {
  (void)vfs;
  return unix_vfs->xOpen(unix_vfs, name, file, flags | SQLITE_OPEN_NOFOLLOW, actual);
}

static bool allowed_pragma(const char *name, const char *argument) {
  static const char *const names[] = {"table_info",  "table_xinfo",      "index_list", "index_info",
                                      "index_xinfo", "foreign_key_list", "table_list"};
  for (size_t index = 0; index < sizeof(names) / sizeof(names[0]); index++) {
    if (sqlite3_stricmp(name, names[index]) == 0)
      return true;
  }
  return argument == NULL &&
         (sqlite3_stricmp(name, "database_list") == 0 ||
          sqlite3_stricmp(name, "schema_version") == 0 ||
          sqlite3_stricmp(name, "user_version") == 0 || sqlite3_stricmp(name, "encoding") == 0);
}

static int authorize(void *context, int operation, const char *first, const char *second,
                     const char *database, const char *trigger) {
  (void)context;
  (void)database;
  (void)trigger;
  switch (operation) {
    case SQLITE_SELECT:
    case SQLITE_READ:
    case SQLITE_FUNCTION:
    case SQLITE_RECURSIVE:
    case SQLITE_TRANSACTION:
    case SQLITE_SAVEPOINT:
      return SQLITE_OK;
    case SQLITE_PRAGMA:
      return allowed_pragma(first, second) ? SQLITE_OK : SQLITE_DENY;
    default:
      return SQLITE_DENY;
  }
}

static int cancelled(void *context) {
  struct sqlite_query *query = context;
  if ((query->stopping != NULL && *query->stopping) || clock_monotonic_ms() >= query->deadline_ms)
    return 1;
  if (query->connection < 0)
    return 0;
  struct pollfd peer = {.fd = query->connection, .events = POLLIN | POLLRDHUP};
  if (poll(&peer, 1, 0) < 0 || (peer.revents & (POLLHUP | POLLRDHUP | POLLERR | POLLNVAL)))
    return 1;
  if (peer.revents & POLLIN) {
    unsigned char byte;
    return recv(query->connection, &byte, 1, MSG_PEEK | MSG_DONTWAIT) == 0;
  }
  return 0;
}

static bool safe_path(const char *path) {
  if (*path == '/')
    path++;
  if (*path == '\0')
    return false;
  const char *component = path;
  for (const char *position = path;; position++) {
    if (*position != '/' && *position != '\0')
      continue;
    size_t length = (size_t)(position - component);
    if (length == 0 || (length == 1 && component[0] == '.') ||
        (length == 2 && component[0] == '.' && component[1] == '.'))
      return false;
    if (*position == '\0')
      return true;
    component = position + 1;
  }
}

int sqlite_query_open(struct sqlite_query *query, const char *path) {
  if (!safe_path(path))
    return SQLITE_CANTOPEN;
  if (strlen(path) >= PATH_MAX)
    return SQLITE_CANTOPEN;
  int descriptor = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
  struct stat details;
  unsigned char header[16];
  bool regular = descriptor >= 0 && fstat(descriptor, &details) == 0 && S_ISREG(details.st_mode);
  bool valid = regular && read(descriptor, header, sizeof(header)) == sizeof(header) &&
               memcmp(header, "SQLite format 3\0", sizeof(header)) == 0;
  if (descriptor >= 0)
    close(descriptor);
  if (!regular)
    return SQLITE_CANTOPEN;
  if (!valid)
    return SQLITE_NOTADB;
  static const char *const suffixes[] = {"-wal", "-shm", "-journal"};
  for (size_t index = 0; index < sizeof(suffixes) / sizeof(suffixes[0]); index++) {
    char sidecar[PATH_MAX + 9];
    sqlite3_snprintf(sizeof(sidecar), sidecar, "%s%s", path, suffixes[index]);
    if (lstat(sidecar, &details) == 0 && !S_ISREG(details.st_mode))
      return SQLITE_CANTOPEN;
  }
  if (unix_vfs == NULL) {
    sqlite3_initialize();
    unix_vfs = sqlite3_vfs_find(NULL);
    jailed_vfs = *unix_vfs;
    jailed_vfs.zName = "nibrun-jailed";
    jailed_vfs.xOpen = open_without_symlinks;
    sqlite3_vfs_register(&jailed_vfs, 0);
    sqlite3_hard_heap_limit64(16 * 1024 * 1024);
  }
  int code = sqlite3_open_v2(path, &query->database,
                             SQLITE_OPEN_READONLY | SQLITE_OPEN_NOFOLLOW | SQLITE_OPEN_NOMUTEX,
                             jailed_vfs.zName);
  if (code != SQLITE_OK)
    return code;
  sqlite3_extended_result_codes(query->database, 1);
  sqlite3_busy_timeout(query->database, 250);
  sqlite3_limit(query->database, SQLITE_LIMIT_LENGTH, SQLITE_REQUEST_MAX_BYTES);
  sqlite3_limit(query->database, SQLITE_LIMIT_SQL_LENGTH, SQLITE_REQUEST_MAX_BYTES);
  sqlite3_limit(query->database, SQLITE_LIMIT_COLUMN, 256);
  sqlite3_limit(query->database, SQLITE_LIMIT_VARIABLE_NUMBER, 256);
  sqlite3_db_config(query->database, SQLITE_DBCONFIG_DEFENSIVE, 1, NULL);
  sqlite3_db_config(query->database, SQLITE_DBCONFIG_TRUSTED_SCHEMA, 0, NULL);
  sqlite3_set_authorizer(query->database, authorize, NULL);
  sqlite3_progress_handler(query->database, 1000, cancelled, query);
  query->deadline_ms = clock_monotonic_ms() + SQLITE_QUERY_TIMEOUT_MS;
  return sqlite3_exec(query->database, "SELECT name FROM sqlite_schema LIMIT 1", NULL, NULL, NULL);
}
