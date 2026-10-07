#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>
#include "expect.h"
#include "../src/guest-sqlite.h"
#include "../src/paths.h"
#include "../src/sqlite-database.h"

static int connect_to(const struct sockaddr_un *address) {
  int connection = socket(AF_UNIX, SOCK_STREAM, 0);
  EXPECT(connection >= 0);
  EXPECT(connect(connection, (const struct sockaddr *)address, sizeof(*address)) == 0);
  return connection;
}

static int frame(int connection, unsigned char operation, const char *body) {
  unsigned char bytes[256];
  memcpy(bytes, SQLITE_WIRE_MAGIC, 4);
  bytes[4] = operation;
  size_t size = strlen(body);
  struct sqlite_wire length = {.bytes = bytes + 5, .length = 4};
  sqlite_wire_write_integer(&length, size, 4);
  memcpy(bytes + 9, body, size);
  EXPECT(send(connection, bytes, size + 9, MSG_NOSIGNAL) == (ssize_t)size + 9);
  EXPECT(recv(connection, bytes, 9, MSG_WAITALL) == 9);
  struct sqlite_wire response = {.bytes = bytes + 5, .length = 4};
  size_t response_size = (size_t)sqlite_wire_integer(&response, 4);
  unsigned char output[256];
  EXPECT(response_size <= sizeof(output));
  if (response_size > 0 && response_size <= sizeof(output))
    EXPECT(recv(connection, output, response_size, MSG_WAITALL) == (ssize_t)response_size);
  return bytes[4];
}

int main(void) {
  char directory[] = "/tmp/nibrun-sqlite-listener-XXXXXX";
  EXPECT(mkdtemp(directory) != NULL);
  EXPECT(chmod(directory, 0755) == 0);
  char database_path[256];
  snprintf(database_path, sizeof(database_path), "%s/app.db", directory);
  sqlite3 *database = NULL;
  EXPECT(sqlite3_open(database_path, &database) == SQLITE_OK);
  EXPECT(sqlite3_exec(database, "CREATE TABLE items(value)", NULL, NULL, NULL) == SQLITE_OK);
  EXPECT(sqlite3_close(database) == SQLITE_OK);
  EXPECT(chown(database_path, TENANT_UID, TENANT_GID) == 0);
  int listener = socket(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK, 0);
  struct sockaddr_un address = {.sun_family = AF_UNIX};
  snprintf(address.sun_path, sizeof(address.sun_path), "%s/socket", directory);
  EXPECT(bind(listener, (const struct sockaddr *)&address, sizeof(address)) == 0);
  EXPECT(listen(listener, 8) == 0);
  pid_t process = fork();
  EXPECT(process >= 0);
  if (process == 0) {
    if (setpgid(0, 0) != 0)
      _exit(1);
    struct guest_sqlite_listener channel = {
        .descriptor = listener, .mount_point = directory, .timeout_ms = 5000};
    guest_sqlite_serve(&channel);
    _exit(0);
  }
  setpgid(process, process);
  close(listener);
  int connections[5];
  for (size_t index = 0; index < 4; index++) {
    connections[index] = connect_to(&address);
    EXPECT(frame(connections[index], SQLITE_WIRE_OPEN, "app.db") == SQLITE_WIRE_OK);
    EXPECT(frame(connections[index], SQLITE_WIRE_SEQUENCE, "BEGIN; SELECT * FROM items") ==
           SQLITE_WIRE_OK);
  }
  connections[4] = connect_to(&address);
  unsigned char rejection[9];
  EXPECT(recv(connections[4], rejection, sizeof(rejection), MSG_WAITALL) == sizeof(rejection));
  EXPECT(rejection[4] == SQLITE_WIRE_ERROR);
  close(connections[4]);
  EXPECT(kill(process, SIGTERM) == 0);
  int status;
  EXPECT(waitpid(process, &status, 0) == process);
  EXPECT(WIFEXITED(status) && WEXITSTATUS(status) == 0);
  for (size_t index = 0; index < 4; index++) {
    unsigned char byte;
    EXPECT(recv(connections[index], &byte, 1, 0) == 0);
    close(connections[index]);
  }
  EXPECT(sqlite3_open(database_path, &database) == SQLITE_OK);
  EXPECT(sqlite3_exec(database, "VACUUM", NULL, NULL, NULL) == SQLITE_OK);
  sqlite3_close(database);
  unlink(address.sun_path);
  unlink(database_path);
  rmdir(directory);
  return EXPECT_REPORT("sqlite-listener");
}
