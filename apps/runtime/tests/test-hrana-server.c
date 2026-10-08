#include "../src/guest-sqlite.h"
#include "../src/paths.h"
#include <arpa/inet.h>
#include <errno.h>
#include <sqlite3.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

int main(void) {
  const char *directory = "/tmp/hrana-data";
  if (mkdir(directory, 0755) != 0)
    return 1;
  const char *names[] = {"app.db", "other.db"};
  for (size_t index = 0; index < 2; index++) {
    char path[256];
    snprintf(path, sizeof(path), "%s/%s", directory, names[index]);
    sqlite3 *database = NULL;
    if (sqlite3_open(path, &database) != SQLITE_OK ||
        sqlite3_exec(
            database,
            "CREATE TABLE items(value INTEGER); INSERT INTO items VALUES(42)",
            NULL, NULL, NULL) != SQLITE_OK)
      return 1;
    sqlite3_close(database);
    if (chown(path, TENANT_UID, TENANT_GID) != 0)
      return 1;
  }
  if (symlink("app.db", "/tmp/hrana-data/link.db") != 0)
    return 1;
  int listener = socket(AF_INET, SOCK_STREAM, 0);
  int reuse = 1;
  setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
  struct sockaddr_in address = {.sin_family = AF_INET,
                                .sin_port = htons(8080),
                                .sin_addr.s_addr = htonl(INADDR_ANY)};
  if (bind(listener, (const struct sockaddr *)&address, sizeof(address)) != 0 ||
      listen(listener, 16) != 0)
    return 1;
  for (;;) {
    while (waitpid(-1, NULL, WNOHANG) > 0) {
    }
    int connection = accept(listener, NULL, NULL);
    if (connection < 0)
      continue;
    if (fork() == 0) {
      close(listener);
      struct guest_sqlite_request request = {.connection = connection,
                                             .mount_point = directory,
                                             .timeout_ms = 30000};
      guest_sqlite_answer(&request);
      close(connection);
      _exit(0);
    }
    close(connection);
  }
}
