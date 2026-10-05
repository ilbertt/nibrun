#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>
#include "expect.h"
#include "../src/guest-sqlite.h"
#include "../src/paths.h"
#include "../src/sqlite-query.h"

static unsigned char output[SQLITE_WIRE_MAX_BYTES];
static size_t output_size;

static bool frame(int connection, unsigned char operation, const void *bytes, size_t size) {
  unsigned char header[SQLITE_WIRE_HEADER_BYTES];
  memcpy(header, SQLITE_WIRE_MAGIC, 4);
  header[4] = operation;
  struct sqlite_wire length = {.bytes = header + 5, .length = 4};
  sqlite_wire_write_integer(&length, size, 4);
  return send(connection, header, sizeof(header), MSG_NOSIGNAL) == sizeof(header) &&
         (size == 0 || send(connection, bytes, size, MSG_NOSIGNAL) == (ssize_t)size);
}

static int reply(int connection) {
  unsigned char header[SQLITE_WIRE_HEADER_BYTES];
  if (recv(connection, header, sizeof(header), MSG_WAITALL) != sizeof(header))
    return -1;
  EXPECT(memcmp(header, SQLITE_WIRE_MAGIC, 4) == 0);
  struct sqlite_wire length = {.bytes = header + 5, .length = 4};
  output_size = (size_t)sqlite_wire_integer(&length, 4);
  EXPECT(output_size <= sizeof(output));
  if (output_size > sizeof(output))
    return -1;
  if (output_size != 0) {
    EXPECT(recv(connection, output, output_size, MSG_WAITALL) == (ssize_t)output_size);
  }
  return header[4];
}

static pid_t start(const char *directory, int *connection) {
  int pair[2];
  EXPECT(socketpair(AF_UNIX, SOCK_STREAM, 0, pair) == 0);
  pid_t process = fork();
  EXPECT(process >= 0);
  if (process == 0) {
    close(pair[0]);
    const struct guest_sqlite_request request = {
        .connection = pair[1], .mount_point = directory, .timeout_ms = 500};
    guest_sqlite_answer(&request);
    close(pair[1]);
    _exit(0);
  }
  close(pair[1]);
  *connection = pair[0];
  return process;
}

static void reap(pid_t process) {
  int status;
  EXPECT(waitpid(process, &status, 0) == process);
  EXPECT(WIFEXITED(status) && WEXITSTATUS(status) == 0);
}

static void execute(int connection, const char *sql) {
  unsigned char bytes[1024];
  struct sqlite_wire request = {.bytes = bytes, .length = sizeof(bytes)};
  sqlite_wire_write_string(&request, sql, strlen(sql));
  sqlite_wire_write_integer(&request, 1, 1);
  sqlite_wire_write_integer(&request, 0, 4);
  EXPECT(frame(connection, SQLITE_WIRE_EXECUTE, bytes, request.position));
}

static void valid_session(const char *directory) {
  int connection;
  pid_t process = start(directory, &connection);
  EXPECT(frame(connection, SQLITE_WIRE_OPEN, "/app.db", 7));
  EXPECT(reply(connection) == SQLITE_WIRE_OK);
  execute(connection, "SELECT value FROM items");
  EXPECT(reply(connection) == SQLITE_WIRE_RESULT);
  EXPECT(frame(connection, SQLITE_WIRE_SEQUENCE, "BEGIN", 5));
  EXPECT(reply(connection) == SQLITE_WIRE_OK);
  EXPECT(frame(connection, SQLITE_WIRE_CLOSE, NULL, 0));
  EXPECT(reply(connection) == SQLITE_WIRE_OK);
  close(connection);
  reap(process);
}

static void forbidden_path(const char *directory, const char *path) {
  int connection;
  pid_t process = start(directory, &connection);
  EXPECT(frame(connection, SQLITE_WIRE_OPEN, path, strlen(path)));
  EXPECT(reply(connection) == SQLITE_WIRE_ERROR);
  close(connection);
  reap(process);
}

static void disconnect_query(const char *directory) {
  int connection;
  pid_t process = start(directory, &connection);
  EXPECT(frame(connection, SQLITE_WIRE_OPEN, "app.db", 6));
  EXPECT(reply(connection) == SQLITE_WIRE_OK);
  execute(connection,
          "WITH RECURSIVE forever(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM forever) SELECT "
          "sum(x) FROM forever");
  close(connection);
  reap(process);
}

static void invalid_frames(const char *directory) {
  int connection;
  pid_t process = start(directory, &connection);
  unsigned char header[9] = {'N', 'B', 'S', '1', 0, 0, 1, 0, 1};
  EXPECT(send(connection, header, sizeof(header), MSG_NOSIGNAL) == sizeof(header));
  close(connection);
  reap(process);
  process = start(directory, &connection);
  EXPECT(send(connection, "BAD1", 4, MSG_NOSIGNAL) == 4);
  close(connection);
  reap(process);
}

static void idle_session(const char *directory) {
  int connection;
  pid_t process = start(directory, &connection);
  EXPECT(frame(connection, SQLITE_WIRE_OPEN, "app.db", 6));
  EXPECT(reply(connection) == SQLITE_WIRE_OK);
  reap(process);
  EXPECT(reply(connection) == -1);
  close(connection);
}

int main(void) {
  char directory[] = "/tmp/nibrun-guest-sqlite-XXXXXX";
  EXPECT(mkdtemp(directory) != NULL);
  EXPECT(chmod(directory, 0755) == 0);
  char path[256];
  snprintf(path, sizeof(path), "%s/app.db", directory);
  sqlite3 *database = NULL;
  EXPECT(sqlite3_open(path, &database) == SQLITE_OK);
  EXPECT(sqlite3_exec(database, "CREATE TABLE items(value); INSERT INTO items VALUES('hello')",
                      NULL, NULL, NULL) == SQLITE_OK);
  EXPECT(sqlite3_close(database) == SQLITE_OK);
  EXPECT(chown(path, TENANT_UID, TENANT_GID) == 0);
  valid_session(directory);
  disconnect_query(directory);
  idle_session(directory);
  forbidden_path(directory, "../app.db");
  forbidden_path(directory, "/etc/passwd");
  forbidden_path(directory, "missing.db");
  char link[256];
  snprintf(link, sizeof(link), "%s/link.db", directory);
  EXPECT(symlink("app.db", link) == 0);
  forbidden_path(directory, "link.db");
  unlink(link);
  snprintf(link, sizeof(link), "%s/escape", directory);
  EXPECT(symlink("/", link) == 0);
  forbidden_path(directory, "escape/etc/passwd");
  unlink(link);
  snprintf(link, sizeof(link), "%s/app.db-wal", directory);
  EXPECT(symlink("/etc/passwd", link) == 0);
  forbidden_path(directory, "app.db");
  unlink(link);
  invalid_frames(directory);
  unlink(path);
  rmdir(directory);
  return EXPECT_REPORT("guest-sqlite");
}
