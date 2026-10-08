#include "clock.h"
#include "guest-sqlite.h"
#include "log.h"
#include "paths.h"
#include "sqlite-hrana.h"
#include "sqlite-values.h"
#include "vsock.h"
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>

static volatile sig_atomic_t stopping;

static void stop_requested(int signal_number) {
  (void)signal_number;
  stopping = 1;
}

static bool prepare_signals(void) {
  stopping = 0;
  struct sigaction action = {.sa_handler = stop_requested};
  sigemptyset(&action.sa_mask);
  sigset_t unblocked;
  sigemptyset(&unblocked);
  sigaddset(&unblocked, SIGTERM);
  return sigaction(SIGTERM, &action, NULL) == 0 &&
         sigprocmask(SIG_UNBLOCK, &unblocked, NULL) == 0;
}

static bool transfer(int connection, unsigned char *bytes, size_t length,
                     bool sending, uint32_t timeout_ms) {
  uint64_t deadline = clock_monotonic_ms() + timeout_ms;
  size_t position = 0;
  while (!stopping && position < length) {
    int remaining = clock_remaining_ms(deadline);
    if (remaining == 0)
      return false;
    struct pollfd peer = {.fd = connection,
                          .events = sending ? POLLOUT : POLLIN};
    int ready = poll(&peer, 1, remaining);
    if (ready < 0 && errno == EINTR)
      continue;
    if (ready <= 0)
      return false;
    ssize_t count = sending
                        ? send(connection, bytes + position, length - position,
                               MSG_NOSIGNAL | MSG_DONTWAIT)
                        : recv(connection, bytes + position, length - position,
                               MSG_DONTWAIT);
    if (count < 0 && (errno == EINTR || errno == EAGAIN))
      continue;
    if (count <= 0)
      return false;
    position += (size_t)count;
  }
  return !stopping;
}

static bool jail_worker(const char *mount_point) {
  const struct rlimit memory = {.rlim_cur = 128 * 1024 * 1024,
                                .rlim_max = 128 * 1024 * 1024};
  const struct rlimit files = {.rlim_cur = 64, .rlim_max = 64};
  int oom = open("/proc/self/oom_score_adj", O_WRONLY | O_CLOEXEC);
  if (oom >= 0) {
    ssize_t count = write(oom, "500", 3);
    (void)count;
    close(oom);
  }
  return setrlimit(RLIMIT_AS, &memory) == 0 &&
         setrlimit(RLIMIT_NOFILE, &files) == 0 && chdir(mount_point) == 0 &&
         chroot(".") == 0 && chdir("/") == 0 && setgroups(0, NULL) == 0 &&
         setgid(TENANT_GID) == 0 && setuid(TENANT_UID) == 0;
}

#define SQLITE_HTTP_HEADER_BYTES 16384
struct http_request {
  char header[SQLITE_HTTP_HEADER_BYTES];
  char *method;
  char *target;
  size_t length;
  bool close;
};

static bool header_line(const char *line) {
  if (*line == ' ' || *line == '\t')
    return false;
  for (const unsigned char *byte = (const unsigned char *)line; *byte; byte++)
    if (*byte < 32 && *byte != '\t')
      return false;
  return true;
}

static bool read_header(const struct guest_sqlite_request *request,
                        struct http_request *http) {
  uint64_t deadline = clock_monotonic_ms() + request->timeout_ms;
  size_t position = 0;
  for (;;) {
    int remaining = clock_remaining_ms(deadline);
    if (position + 1 >= sizeof(http->header) || remaining <= 0 ||
        !transfer(request->connection, (unsigned char *)http->header + position,
                  1, false, (uint32_t)remaining))
      return false;
    position++;
    if (position >= 4 &&
        memcmp(http->header + position - 4, "\r\n\r\n", 4) == 0)
      break;
  }
  http->header[position] = 0;
  if (memchr(http->header, 0, position) != NULL)
    return false;
  char *line = strstr(http->header, "\r\n");
  if (line == NULL)
    return false;
  *line = 0;
  char *first = strchr(http->header, ' ');
  if (first == NULL)
    return false;
  *first = 0;
  http->method = http->header;
  http->target = first + 1;
  char *last = strchr(http->target, ' ');
  if (last == NULL || strcmp(last + 1, "HTTP/1.1") != 0)
    return false;
  *last = 0;
  bool found_length = false;
  for (char *field = line + 2; *field != '\r';) {
    char *end = strstr(field, "\r\n");
    if (end == NULL)
      return false;
    *end = 0;
    if (!header_line(field))
      return false;
    char *colon = strchr(field, ':');
    if (colon == NULL)
      return false;
    *colon = 0;
    for (char *name = field; *name; name++)
      if (!((*name >= 'A' && *name <= 'Z') || (*name >= 'a' && *name <= 'z') ||
            *name == '-'))
        return false;
    char *value = colon + 1;
    while (*value == ' ' || *value == '\t')
      value++;
    if (strcasecmp(field, "Transfer-Encoding") == 0)
      return false;
    if (strcasecmp(field, "Content-Length") == 0) {
      if (found_length || *value == 0)
        return false;
      found_length = true;
      size_t length = 0;
      for (const char *digit = value; *digit; digit++) {
        if (*digit < '0' || *digit > '9' || length > SQLITE_HTTP_MAX_BYTES / 10)
          return false;
        length = length * 10 + (size_t)(*digit - '0');
      }
      if (length > SQLITE_HTTP_MAX_BYTES)
        return false;
      http->length = length;
    }
    if (strcasecmp(field, "Connection") == 0 && strcasecmp(value, "close") == 0)
      http->close = true;
    field = end + 2;
  }
  return strcmp(http->method, "POST") == 0
             ? found_length
             : strcmp(http->method, "GET") == 0 && http->length == 0;
}

static int hex_digit(unsigned char byte) {
  if (byte >= '0' && byte <= '9')
    return byte - '0';
  if (byte >= 'a' && byte <= 'f')
    return byte - 'a' + 10;
  if (byte >= 'A' && byte <= 'F')
    return byte - 'A' + 10;
  return -1;
}

static bool database_path(const struct http_request *http, char *path) {
  if (strncmp(http->target, "/sqlite/", 8) != 0)
    return false;
  const char *end = strstr(http->target + 8, "/v2");
  if (end == NULL ||
      (strcmp(end, "/v2") != 0 && strcmp(end, "/v2/pipeline") != 0))
    return false;
  if ((strcmp(http->method, "GET") == 0) != (strcmp(end, "/v2") == 0))
    return false;
  size_t length = 0;
  for (const char *position = http->target + 8; position < end; position++) {
    unsigned char byte = (unsigned char)*position;
    if (byte == '%') {
      if (end - position < 3)
        return false;
      int high = hex_digit((unsigned char)position[1]);
      int low = hex_digit((unsigned char)position[2]);
      if (high < 0 || low < 0)
        return false;
      byte = (unsigned char)(high * 16 + low);
      position += 2;
    }
    if (byte == 0 || length + 1 >= PATH_MAX)
      return false;
    path[length++] = (char)byte;
  }
  path[length] = 0;
  return length > 0;
}

static bool node_budget(const json_t *json, size_t *remaining, size_t depth) {
  if (json == NULL || *remaining == 0 || depth > SQLITE_JSON_MAX_DEPTH)
    return false;
  (*remaining)--;
  if (json_is_array(json)) {
    for (size_t index = 0; index < json_array_size(json); index++)
      if (!node_budget(json_array_get(json, index), remaining, depth + 1))
        return false;
  } else if (json_is_object(json)) {
    const char *key;
    json_t *value;
    json_object_foreach((json_t *)json, key, value) {
      (void)key;
      if (!node_budget(value, remaining, depth + 1))
        return false;
    }
  }
  return true;
}

struct json_output {
  char *bytes;
  size_t length;
};

static int append_json(const char *bytes, size_t length, void *context) {
  struct json_output *output = context;
  if (length > SQLITE_RESPONSE_MAX_BYTES - output->length)
    return -1;
  memcpy(output->bytes + output->length, bytes, length);
  output->length += length;
  output->bytes[output->length] = 0;
  return 0;
}

static bool send_json(const struct guest_sqlite_request *request, int status,
                      const json_t *json, char *output, bool close_connection) {
  struct json_output serialized = {.bytes = output};
  if (json == NULL ||
      json_dump_callback(json, append_json, &serialized, JSON_COMPACT) != 0) {
    status = 413;
    close_connection = true;
    strcpy(output, "{\"code\":\"SQLITE_TOOBIG\",\"message\":\"Response exceeds "
                   "query limits\"}");
  }
  size_t size = strlen(output);
  char header[256];
  int length = snprintf(
      header, sizeof(header),
      "HTTP/1.1 %d %s\r\nContent-Type: application/json\r\nContent-Length: "
      "%zu\r\nConnection: %s\r\n\r\n",
      status, status == 200 ? "OK" : "Error", size,
      close_connection ? "close" : "keep-alive");
  return transfer(request->connection, (unsigned char *)header, (size_t)length,
                  true, SQLITE_QUERY_TIMEOUT_MS) &&
         transfer(request->connection, (unsigned char *)output, size, true,
                  SQLITE_QUERY_TIMEOUT_MS) &&
         !close_connection;
}

void guest_sqlite_answer(const struct guest_sqlite_request *request) {
  if (!prepare_signals())
    return;
  struct sqlite_hrana stream = {
      .query = {.connection = request->connection, .stopping = &stopping}};
  if (!jail_worker(request->mount_point))
    return;
  char *input = malloc(SQLITE_HTTP_MAX_BYTES + 1);
  char *output = malloc(SQLITE_RESPONSE_MAX_BYTES + 1);
  if (input == NULL || output == NULL) {
    free(input);
    free(output);
    return;
  }
  char selected[PATH_MAX] = {0};
  for (;;) {
    struct http_request http = {0};
    if (!read_header(request, &http)) {
      json_t *error = sqlite_hrana_error(&stream, SQLITE_MISUSE);
      send_json(request, 400, error, output, true);
      json_decref(error);
      break;
    }
    char path[PATH_MAX];
    int status = 200;
    json_t *reply = NULL;
    bool route = database_path(&http, path) &&
                 (selected[0] == 0 || strcmp(selected, path) == 0);
    if (!route) {
      reply = sqlite_hrana_error(&stream, SQLITE_CANTOPEN);
      status = 400;
    } else if (stream.query.database == NULL) {
      int code = sqlite_query_open(&stream.query, path);
      if (code != SQLITE_OK) {
        reply = sqlite_hrana_error(&stream, code);
        status = 400;
      } else
        strcpy(selected, path);
    }
    if (reply == NULL && strcmp(http.method, "GET") == 0)
      reply = json_object();
    else if (reply == NULL) {
      if (!transfer(request->connection, (unsigned char *)input, http.length,
                    false, SQLITE_QUERY_TIMEOUT_MS))
        break;
      input[http.length] = 0;
      json_error_t error;
      json_t *body = json_loadb(
          input, http.length, JSON_REJECT_DUPLICATES | JSON_ALLOW_NUL, &error);
      size_t budget = SQLITE_JSON_MAX_NODES;
      if (body == NULL || !json_is_object(body) ||
          !node_budget(body, &budget, 0)) {
        reply = sqlite_hrana_error(&stream, SQLITE_MISUSE);
        status = 400;
      } else
        reply = sqlite_hrana_pipeline(&stream, body, &status);
      json_decref(body);
    }
    bool keep = send_json(request, status, reply, output,
                          http.close || status != 200 || stream.closed);
    json_decref(reply);
    if (!keep)
      break;
  }
  sqlite_hrana_clear(&stream);
  free(input);
  free(output);
}

void guest_sqlite_refuse(int connection) {
  const char body[] =
      "{\"code\":\"SQLITE_BUSY\",\"message\":\"Too many connections\"}";
  char response[256];
  int length = snprintf(
      response, sizeof(response),
      "HTTP/1.1 503 Service Unavailable\r\nContent-Type: "
      "application/json\r\nContent-Length: %zu\r\nConnection: close\r\n\r\n%s",
      sizeof(body) - 1, body);
  transfer(connection, (unsigned char *)response, (size_t)length, true, 250);
}
