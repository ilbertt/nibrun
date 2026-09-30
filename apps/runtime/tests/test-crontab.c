#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>

#include "../src/crontab.h"
#include "expect.h"

struct option_case {
  const char *argument;
  enum crontab_verb verb;
  bool read_input;
  const char *path;
};

static void check_option(const struct option_case *test) {
  char *values[] = {"crontab", (char *)test->argument};
  struct crontab_arguments arguments = {.count = 2, .values = values};
  struct crontab_options options = crontab_parse_options(&arguments);
  EXPECT(options.valid);
  EXPECT(options.verb == test->verb);
  EXPECT(options.read_input == test->read_input);
  EXPECT(test->path == NULL ? options.path == NULL : strcmp(test->path, options.path) == 0);
}

static void test_options(void) {
  const struct option_case cases[] = {
      {.argument = "-", .verb = CRONTAB_REPLACE, .read_input = true},
      {.argument = "jobs.txt", .verb = CRONTAB_REPLACE, .read_input = true, .path = "jobs.txt"},
      {.argument = "-l", .verb = CRONTAB_LIST},
      {.argument = "-r", .verb = CRONTAB_REPLACE},
  };
  for (size_t index = 0; index < sizeof(cases) / sizeof(cases[0]); index++) {
    check_option(&cases[index]);
  }
  char *values[] = {"crontab", "-e", "extra"};
  struct crontab_arguments arguments = {.count = 2, .values = values};
  EXPECT(!crontab_parse_options(&arguments).valid);
  values[1] = "-u";
  EXPECT(!crontab_parse_options(&arguments).valid);
  values[1] = "jobs.txt";
  arguments.count = 3;
  EXPECT(!crontab_parse_options(&arguments).valid);
  arguments.count = 1;
  EXPECT(!crontab_parse_options(&arguments).valid);
}

static void test_source_limits(void) {
  FILE *file = tmpfile();
  EXPECT(file != NULL);
  if (file == NULL) {
    return;
  }
  for (size_t index = 0; index < CRONTAB_MAX_BYTES; index++) {
    fputc('x', file);
  }
  fflush(file);
  rewind(file);
  struct crontab_source source = {.descriptor = fileno(file)};
  EXPECT(crontab_read_source(&source));
  EXPECT(source.length == CRONTAB_MAX_BYTES);
  EXPECT(source.bytes[CRONTAB_MAX_BYTES - 1] == 'x');
  fseek(file, 0, SEEK_END);
  fputc('x', file);
  fflush(file);
  rewind(file);
  source.length = 0;
  EXPECT(!crontab_read_source(&source));
  source.descriptor = -1;
  source.length = 0;
  EXPECT(crontab_read_source(&source));
  EXPECT(source.length == 0);
  fclose(file);
}

struct session_case {
  enum crontab_verb verb;
  const char *source;
  const char *reply;
  enum crontab_status status;
  bool invalid_magic;
  bool invalid_status;
  bool oversized;
  bool truncated;
  int result;
};

struct server_request {
  int connection;
  const struct session_case *test;
};

static void serve(const struct server_request *request) {
  const struct session_case *test = request->test;
  unsigned char header[CRONTAB_HEADER_BYTES];
  EXPECT(recv(request->connection, header, sizeof(header), MSG_WAITALL) == sizeof(header));
  EXPECT(memcmp(header, "NBC1", 4) == 0);
  EXPECT(header[4] == test->verb);
  uint32_t length = 0;
  for (size_t index = 5; index < sizeof(header); index++) {
    length = (length << 8) | header[index];
  }
  EXPECT(length == strlen(test->source));
  unsigned char body[CRONTAB_MAX_BYTES];
  if (length > sizeof(body)) {
    _exit(1);
  }
  if (length != 0) {
    EXPECT(recv(request->connection, body, length, MSG_WAITALL) == length);
  }
  EXPECT(memcmp(body, test->source, length) == 0);
  memcpy(header, test->invalid_magic ? "BAD1" : "NBC1", 4);
  header[4] = test->invalid_status ? 99 : test->status;
  length = test->oversized ? CRONTAB_MAX_BYTES + 1 : (uint32_t)strlen(test->reply);
  for (size_t index = 0; index < sizeof(length); index++) {
    header[5 + index] = (unsigned char)(length >> (8 * (sizeof(length) - index - 1)));
  }
  for (size_t index = 0; index < sizeof(header); index++) {
    EXPECT(send(request->connection, header + index, 1, MSG_NOSIGNAL) == 1);
  }
  if (!test->invalid_magic && !test->invalid_status && !test->oversized && !test->truncated) {
    EXPECT(send(request->connection, test->reply, strlen(test->reply), MSG_NOSIGNAL) ==
           (ssize_t)strlen(test->reply));
  }
  close(request->connection);
  _exit(expect_failures == 0 ? 0 : 1);
}

static void check_session(const struct session_case *test) {
  int pair[2];
  EXPECT(socketpair(AF_UNIX, SOCK_STREAM, 0, pair) == 0);
  FILE *output = tmpfile();
  FILE *errors = tmpfile();
  EXPECT(output != NULL && errors != NULL);
  pid_t server = fork();
  EXPECT(server >= 0);
  if (server == 0) {
    close(pair[0]);
    struct server_request request = {.connection = pair[1], .test = test};
    serve(&request);
  }
  close(pair[1]);
  struct crontab_exchange exchange = {.connection = pair[0],
                                     .source = (const unsigned char *)test->source,
                                     .length = strlen(test->source),
                                     .output = fileno(output),
                                     .errors = fileno(errors),
                                     .verb = test->verb};
  EXPECT(crontab_exchange(&exchange) == test->result);
  close(pair[0]);
  int status;
  EXPECT(waitpid(server, &status, 0) == server);
  EXPECT(WIFEXITED(status) && WEXITSTATUS(status) == 0);
  rewind(output);
  unsigned char bytes[CRONTAB_MAX_BYTES];
  size_t length = fread(bytes, 1, sizeof(bytes), output);
  if (test->result == 0) {
    EXPECT(length == strlen(test->reply));
    EXPECT(memcmp(bytes, test->reply, length) == 0);
    EXPECT(ftell(errors) == 0);
  } else {
    EXPECT(length == 0);
    EXPECT(ftell(errors) > 0);
  }
  fclose(output);
  fclose(errors);
}

static void test_sessions(void) {
  const char *source = "# source\r\nNAME='héllo $world'\r\n*/5 * * * * /mnt/artifact/server task%one\r\n";
  struct session_case test = {.verb = CRONTAB_REPLACE, .source = source, .reply = ""};
  check_session(&test);
  test.source = "";
  check_session(&test);
  test.verb = CRONTAB_LIST;
  test.reply = source;
  check_session(&test);
  test.status = CRONTAB_REJECTED;
  test.reply = "Invalid cron expression.";
  test.result = 1;
  check_session(&test);
  test.status = CRONTAB_OK;
  test.invalid_magic = true;
  check_session(&test);
  test.invalid_magic = false;
  test.invalid_status = true;
  check_session(&test);
  test.invalid_status = false;
  test.oversized = true;
  check_session(&test);
  test.oversized = false;
  test.truncated = true;
  check_session(&test);
}

static void test_invalid_request_sends_nothing(void) {
  int pair[2];
  EXPECT(socketpair(AF_UNIX, SOCK_STREAM, 0, pair) == 0);
  FILE *errors = tmpfile();
  struct crontab_exchange exchange = {.connection = pair[0],
                                     .source = NULL,
                                     .length = CRONTAB_MAX_BYTES + 1,
                                     .output = STDOUT_FILENO,
                                     .errors = fileno(errors),
                                     .verb = CRONTAB_REPLACE};
  EXPECT(crontab_exchange(&exchange) == 1);
  exchange.verb = CRONTAB_LIST;
  exchange.length = 1;
  EXPECT(crontab_exchange(&exchange) == 1);
  struct pollfd peer = {.fd = pair[1], .events = POLLIN};
  EXPECT(poll(&peer, 1, 0) == 0);
  close(pair[0]);
  close(pair[1]);
  fclose(errors);
}

int main(void) {
  alarm(15);
  test_options();
  test_source_limits();
  test_sessions();
  test_invalid_request_sends_nothing();
  return EXPECT_REPORT("crontab");
}
