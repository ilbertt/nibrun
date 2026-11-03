#include <arpa/inet.h>
#include <errno.h>
#include <netinet/in.h>
#include <sqlite3.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

static sqlite3 *database;
static void *allocation;

static int open_database(void) {
  if (mkdir("data", 0755) < 0 && errno != EEXIST)
    return 1;
  if (sqlite3_open("data/app.db", &database) != SQLITE_OK)
    return 1;
  return sqlite3_exec(database,
                      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS "
                      "kept(value INTEGER);"
                      "INSERT INTO kept VALUES(9223372036854775807);",
                      NULL, NULL, NULL) != SQLITE_OK;
}

static void reply(int client, const char *path) {
  int result = 0;
  if (strcmp(path, "/cron") == 0)
    result = system("/usr/bin/crontab -l >/dev/null");
  if (strcmp(path, "/write") == 0)
    result =
        sqlite3_exec(database, "INSERT INTO kept VALUES(42)", NULL, NULL, NULL);
  if (strcmp(path, "/memory") == 0 && allocation == NULL) {
    const size_t bytes = 160 * 1024 * 1024;
    allocation = malloc(bytes);
    if (allocation == NULL)
      result = 1;
    else
      for (size_t offset = 0; offset < bytes; offset += 4096)
        ((volatile unsigned char *)allocation)[offset] = 1;
  }
  if (strcmp(path, "/replace-data") == 0) {
    sqlite3_close(database);
    database = NULL;
    sqlite3 *outside = NULL;
    if (sqlite3_open("/tmp/outside.db", &outside) != SQLITE_OK)
      result = 1;
    else
      result =
          sqlite3_exec(outside, "CREATE TABLE IF NOT EXISTS outside(value);",
                       NULL, NULL, NULL);
    sqlite3_close(outside);
    if (rename("data", "saved-data") < 0 || symlink("/tmp", "data") < 0)
      result = 1;
  }
  if (strcmp(path, "/restore-data") == 0) {
    if (unlink("data") < 0 || rename("saved-data", "data") < 0 ||
        open_database() != 0)
      result = 1;
  }
  char body[64];
  int length = snprintf(body, sizeof(body), "%ld", (long)getpid());
  char response[256];
  int size = snprintf(
      response, sizeof(response),
      "HTTP/1.1 %d Result\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s",
      result == 0 ? 200 : 500, length, body);
  ssize_t sent = send(client, response, (size_t)size, MSG_NOSIGNAL);
  (void)sent;
}

int main(void) {
  if (open_database() != 0)
    return 1;
  int listener = socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
  int enabled = 1;
  setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &enabled, sizeof(enabled));
  struct sockaddr_in address = {.sin_family = AF_INET,
                                .sin_port = htons(3000),
                                .sin_addr.s_addr = htonl(INADDR_ANY)};
  if (listener < 0 ||
      bind(listener, (struct sockaddr *)&address, sizeof(address)) < 0 ||
      listen(listener, 16) < 0)
    return 1;
  for (;;) {
    int client = accept4(listener, NULL, NULL, SOCK_CLOEXEC);
    if (client < 0)
      continue;
    char request[2048] = {0};
    if (recv(client, request, sizeof(request) - 1, 0) > 0) {
      char method[16], path[1024];
      if (sscanf(request, "%15s %1023s", method, path) == 2)
        reply(client, path);
    }
    close(client);
  }
}
