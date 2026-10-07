#include "../src/guest-sqlite.h"
#include "../src/paths.h"
#include "../src/sqlite-hrana.h"
#include "expect.h"
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

static char output[SQLITE_RESPONSE_MAX_BYTES + 1];
static int status;

static json_t *exchange(int connection, const char *method, const char *path,
                        const char *body) {
  char header[1024];
  size_t length = strlen(body);
  int size =
      snprintf(header, sizeof(header),
               "%s %s HTTP/1.1\r\nHost: guest\r\nContent-Length: %zu\r\n\r\n",
               method, path, length);
  EXPECT(send(connection, header, (size_t)size, MSG_NOSIGNAL) == size);
  if (length > 0)
    EXPECT(send(connection, body, length, MSG_NOSIGNAL) == (ssize_t)length);
  size_t position = 0;
  while (position + 1 < sizeof(header)) {
    if (recv(connection, header + position, 1, 0) != 1)
      break;
    position++;
    if (position >= 4 && memcmp(header + position - 4, "\r\n\r\n", 4) == 0)
      break;
  }
  header[position] = 0;
  status = 0;
  sscanf(header, "HTTP/1.1 %d", &status);
  const char *content_length = strstr(header, "Content-Length: ");
  EXPECT(content_length != NULL);
  if (content_length == NULL)
    return NULL;
  length = (size_t)strtoul(content_length + 16, NULL, 10);
  EXPECT(length <= SQLITE_RESPONSE_MAX_BYTES);
  if (length > SQLITE_RESPONSE_MAX_BYTES)
    return NULL;
  EXPECT(recv(connection, output, length, MSG_WAITALL) == (ssize_t)length);
  output[length] = 0;
  json_t *reply = json_loads(output, JSON_ALLOW_NUL, NULL);
  EXPECT(reply != NULL);
  return reply;
}

static pid_t start(const char *directory, int *connection) {
  int pair[2];
  EXPECT(socketpair(AF_UNIX, SOCK_STREAM, 0, pair) == 0);
  pid_t process = fork();
  EXPECT(process >= 0);
  if (process == 0) {
    close(pair[0]);
    struct guest_sqlite_request request = {
        .connection = pair[1], .mount_point = directory, .timeout_ms = 500};
    guest_sqlite_answer(&request);
    close(pair[1]);
    _exit(0);
  }
  close(pair[1]);
  *connection = pair[0];
  return process;
}

static void finish(pid_t process, int connection) {
  close(connection);
  int result;
  EXPECT(waitpid(process, &result, 0) == process);
  EXPECT(WIFEXITED(result) && WEXITSTATUS(result) == 0);
}

static void session(const char *directory) {
  int connection;
  pid_t process = start(directory, &connection);
  json_t *reply = exchange(connection, "GET", "/sqlite/%2Fapp.db/v2", "");
  EXPECT(status == 200);
  json_decref(reply);
  reply = exchange(
      connection, "POST", "/sqlite/%2Fapp.db/v2/pipeline",
      "{\"requests\":[{\"type\":\"execute\",\"stmt\":{\"sql\":\"SELECT "
      "9223372036854775807 AS value, x'00ff' AS blob\"}}]}");
  EXPECT(status == 200);
  EXPECT(strstr(output, "9223372036854775807") != NULL);
  EXPECT(strstr(output, "AP8=") != NULL);
  const json_t *baton = json_object_get(reply, "baton");
  EXPECT(json_is_string(baton));
  char body[512];
  snprintf(body, sizeof(body),
           "{\"baton\":\"%s\",\"requests\":[{\"type\":\"sequence\",\"sql\":"
           "\"BEGIN\"},{\"type\":"
           "\"execute\",\"stmt\":{\"sql\":\"DELETE FROM "
           "items\"}},{\"type\":\"sequence\",\"sql\":\"ROLLBACK\"},{\"type\":"
           "\"close\"}]}",
           json_string_value(baton));
  json_decref(reply);
  reply = exchange(connection, "POST", "/sqlite/%2Fapp.db/v2/pipeline", body);
  EXPECT(status == 200);
  EXPECT(strstr(output, "SQLITE_AUTH") != NULL);
  EXPECT(json_is_null(json_object_get(reply, "baton")));
  json_decref(reply);
  finish(process, connection);
}

static void bad_path(const char *directory) {
  int connection;
  pid_t process = start(directory, &connection);
  json_t *reply = exchange(connection, "GET", "/sqlite/%2F..%2Fapp.db/v2", "");
  EXPECT(status == 400);
  EXPECT(strstr(output, "SQLITE_CANTOPEN") != NULL);
  json_decref(reply);
  finish(process, connection);
}

static void malformed_headers(const char *directory) {
  int connection;
  pid_t process = start(directory, &connection);
  const char request[] = "POST /sqlite/%2Fapp.db/v2/pipeline "
                         "HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: "
                         "1\r\n\r\nx";
  EXPECT(send(connection, request, sizeof(request) - 1, MSG_NOSIGNAL) ==
         sizeof(request) - 1);
  char header[128];
  ssize_t count = recv(connection, header, sizeof(header) - 1, 0);
  EXPECT(count > 0);
  if (count > 0) {
    header[count] = 0;
    EXPECT(strstr(header, "400") != NULL);
  }
  finish(process, connection);
}

int main(void) {
  char directory[] = "/tmp/nibrun-guest-hrana-XXXXXX";
  EXPECT(mkdtemp(directory) != NULL);
  EXPECT(chmod(directory, 0755) == 0);
  char path[256];
  snprintf(path, sizeof(path), "%s/app.db", directory);
  sqlite3 *database = NULL;
  EXPECT(sqlite3_open(path, &database) == SQLITE_OK);
  EXPECT(sqlite3_exec(database,
                      "CREATE TABLE items(value); INSERT INTO items VALUES(42)",
                      NULL, NULL, NULL) == SQLITE_OK);
  sqlite3_close(database);
  EXPECT(chown(path, TENANT_UID, TENANT_GID) == 0);
  session(directory);
  bad_path(directory);
  malformed_headers(directory);
  unlink(path);
  rmdir(directory);
  return EXPECT_REPORT("guest-hrana-http");
}
