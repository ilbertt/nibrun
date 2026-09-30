#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>

#include "../src/guest-cron.h"
#include "../src/paths.h"
#include "../src/supervise.h"
#include "expect.h"

struct peer {
  pid_t worker;
  int connection;
};

struct frame {
  unsigned char code;
  unsigned char body[GUEST_CRON_OUTPUT_MAX_BYTES + 1];
  size_t length;
};

struct request_builder {
  unsigned char bytes[GUEST_CRON_HEADER_BYTES + GUEST_CRON_REQUEST_MAX_BYTES];
  size_t length;
};

struct integer_append {
  struct request_builder *builder;
  uint32_t value;
};

struct string_append {
  struct request_builder *builder;
  const char *text;
};

struct request_send {
  const struct peer *peer;
  struct request_builder *builder;
};

struct bytes_read {
  int connection;
  unsigned char *bytes;
  size_t length;
};

static void append_u32(const struct integer_append *append) {
  struct request_builder *builder = append->builder;
  uint32_t value = append->value;
  builder->bytes[builder->length++] = (unsigned char)(value >> 24);
  builder->bytes[builder->length++] = (unsigned char)(value >> 16);
  builder->bytes[builder->length++] = (unsigned char)(value >> 8);
  builder->bytes[builder->length++] = (unsigned char)value;
}

static void append_string(const struct string_append *append) {
  struct request_builder *builder = append->builder;
  const char *text = append->text;
  size_t length = strlen(text);
  append_u32(&(struct integer_append){.builder = builder, .value = (uint32_t)length});
  memcpy(builder->bytes + builder->length, text, length);
  builder->length += length;
}

static struct request_builder command_request(const char *command) {
  struct request_builder builder = {.length = GUEST_CRON_HEADER_BYTES};
  memcpy(builder.bytes, GUEST_CRON_MAGIC, 4);
  builder.bytes[4] = GUEST_CRON_RUN;
  append_string(&(struct string_append){.builder = &builder, .text = command});
  return builder;
}

static void send_request(const struct request_send *request) {
  const struct peer *peer = request->peer;
  struct request_builder *builder = request->builder;
  size_t end = builder->length;
  builder->length = 5;
  append_u32(&(struct integer_append){.builder = builder,
                                      .value = (uint32_t)(end - GUEST_CRON_HEADER_BYTES)});
  builder->length = end;
  /* Split every length prefix and field across writes. */
  for (size_t index = 0; index < builder->length; index++) {
    if (send(peer->connection, builder->bytes + index, 1, MSG_NOSIGNAL) != 1) {
      EXPECT(false);
      break;
    }
  }
}

static struct peer start_worker(void) {
  int pair[2];
  EXPECT(socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, pair) == 0);
  struct instance_config config = {
      .port = 8080, .tenant_variable_count = 1, .tenant_environment = {"TOKEN=instance-secret"}};
  pid_t worker = fork();
  EXPECT(worker >= 0);
  if (worker == 0) {
    for (int descriptor = STDERR_FILENO + 1; descriptor < 256; descriptor++) {
      if (descriptor != pair[1]) {
        close(descriptor);
      }
    }
    struct guest_cron_request request = {
        .connection = pair[1], .config = &config, .timeout_ms = 250};
    guest_cron_answer(&request);
    close(pair[1]);
    _exit(0);
  }
  close(pair[1]);
  return (struct peer){.worker = worker, .connection = pair[0]};
}

static bool read_bytes(const struct bytes_read *input) {
  int connection = input->connection;
  unsigned char *bytes = input->bytes;
  size_t length = input->length;
  size_t position = 0;
  while (position < length) {
    ssize_t count = recv(connection, bytes + position, length - position, 0);
    if (count <= 0) {
      return false;
    }
    position += (size_t)count;
  }
  return true;
}

static struct frame read_frame(const struct peer *peer) {
  unsigned char header[GUEST_CRON_HEADER_BYTES] = {0};
  EXPECT(read_bytes(&(struct bytes_read){
      .connection = peer->connection, .bytes = header, .length = sizeof(header)}));
  EXPECT(memcmp(header, GUEST_CRON_MAGIC, 4) == 0);
  struct frame frame = {.code = header[4],
                        .length = ((uint32_t)header[5] << 24) | ((uint32_t)header[6] << 16) |
                                  ((uint32_t)header[7] << 8) | header[8]};
  EXPECT(frame.length <= GUEST_CRON_OUTPUT_MAX_BYTES);
  if (frame.length > GUEST_CRON_OUTPUT_MAX_BYTES) {
    exit(1);
  }
  EXPECT(read_bytes(&(struct bytes_read){
      .connection = peer->connection, .bytes = frame.body, .length = frame.length}));
  frame.body[frame.length] = '\0';
  return frame;
}

static void acknowledge(const struct peer *peer) {
  unsigned char byte = GUEST_CRON_ACK;
  EXPECT(send(peer->connection, &byte, 1, MSG_NOSIGNAL) == 1);
}

static void wait_worker(const struct peer *peer) {
  int status;
  EXPECT(waitpid(peer->worker, &status, 0) == peer->worker);
  EXPECT(WIFEXITED(status) && WEXITSTATUS(status) == 0);
}

static void finish_worker(struct peer *peer) {
  close(peer->connection);
  wait_worker(peer);
}

static void test_output_and_exit(void) {
  struct peer peer = start_worker();
  struct request_builder builder = command_request(
      "printf '%s|%s|%s' \"$TOKEN\" \"$VALUE\" \"$PORT\"; printf 'error héllo' >&2; exit 7");
  append_u32(&(struct integer_append){.builder = &builder, .value = 1});
  append_string(
      &(struct string_append){.builder = &builder, .text = "VALUE=$literal 'quoted' héllo"});
  send_request(&(struct request_send){.peer = &peer, .builder = &builder});
  struct frame frame = read_frame(&peer);
  EXPECT(frame.code == GUEST_CRON_STARTED && frame.length == 0);
  acknowledge(&peer);
  char output[256] = {0};
  char errors[256] = {0};
  for (;;) {
    frame = read_frame(&peer);
    if (frame.code == GUEST_CRON_EXIT) {
      EXPECT(frame.length == 8 && frame.body[3] == 7 && frame.body[7] == 0);
      break;
    }
    EXPECT(frame.code == GUEST_CRON_STDOUT || frame.code == GUEST_CRON_STDERR);
    strncat(frame.code == GUEST_CRON_STDOUT ? output : errors, (char *)frame.body, frame.length);
    acknowledge(&peer);
  }
  EXPECT(strcmp(output, "instance-secret|$literal 'quoted' héllo|8080") == 0);
  EXPECT(strcmp(errors, "error héllo") == 0);
  finish_worker(&peer);
}

static void test_maximum_environment(void) {
  struct peer peer = start_worker();
  struct request_builder builder = command_request("printf '%s' \"$ENTRY_255\"");
  append_u32(
      &(struct integer_append){.builder = &builder, .value = CRON_MAX_ENVIRONMENT_VARIABLES});
  for (size_t index = 0; index < CRON_MAX_ENVIRONMENT_VARIABLES; index++) {
    char entry[32];
    snprintf(entry, sizeof(entry), "ENTRY_%zu=value_%zu", index, index);
    append_string(&(struct string_append){.builder = &builder, .text = entry});
  }
  send_request(&(struct request_send){.peer = &peer, .builder = &builder});
  struct frame frame = read_frame(&peer);
  EXPECT(frame.code == GUEST_CRON_STARTED);
  acknowledge(&peer);
  frame = read_frame(&peer);
  EXPECT(frame.code == GUEST_CRON_STDOUT && strcmp((char *)frame.body, "value_255") == 0);
  acknowledge(&peer);
  frame = read_frame(&peer);
  EXPECT(frame.code == GUEST_CRON_EXIT && frame.body[3] == 0 && frame.body[7] == 0);
  finish_worker(&peer);
}

static void test_bounded_output(void) {
  struct peer peer = start_worker();
  struct request_builder builder = command_request(
      "i=0; while [ \"$i\" -lt 3000 ]; do printf 'héllo123'; printf 'errors12' >&2; i=$((i+1)); "
      "done");
  append_u32(&(struct integer_append){.builder = &builder, .value = 0});
  send_request(&(struct request_send){.peer = &peer, .builder = &builder});
  struct frame frame = read_frame(&peer);
  EXPECT(frame.code == GUEST_CRON_STARTED);
  acknowledge(&peer);
  size_t output = 0;
  size_t errors = 0;
  for (;;) {
    frame = read_frame(&peer);
    if (frame.code == GUEST_CRON_EXIT) {
      EXPECT(frame.body[3] == 0 && frame.body[7] == 0);
      break;
    }
    if (frame.code == GUEST_CRON_STDOUT) {
      output += frame.length;
    } else {
      EXPECT(frame.code == GUEST_CRON_STDERR);
      errors += frame.length;
    }
    acknowledge(&peer);
  }
  EXPECT(output == 3000 * strlen("héllo123"));
  EXPECT(errors == 3000 * strlen("errors12"));
  finish_worker(&peer);
}

static pid_t start_long_command(const struct peer *peer) {
  struct request_builder builder = command_request("printf '%s' \"$$\"; sleep 30 & wait");
  append_u32(&(struct integer_append){.builder = &builder, .value = 0});
  send_request(&(struct request_send){.peer = peer, .builder = &builder});
  struct frame frame = read_frame(peer);
  EXPECT(frame.code == GUEST_CRON_STARTED);
  acknowledge(peer);
  frame = read_frame(peer);
  EXPECT(frame.code == GUEST_CRON_STDOUT);
  pid_t process = (pid_t)strtol((char *)frame.body, NULL, 10);
  EXPECT(process > 0);
  acknowledge(peer);
  return process;
}

static void expect_group_gone(pid_t group) {
  /* As a subreaper the test collects descendants killed alongside the shell. */
  while (waitpid(-group, NULL, 0) > 0 || errno == EINTR) {
  }
  EXPECT(kill(-group, 0) < 0 && errno == ESRCH);
}

static void test_disconnect_preserves_other_run(void) {
  struct peer first = start_worker();
  pid_t one = start_long_command(&first);
  struct peer second = start_worker();
  pid_t two = start_long_command(&second);
  EXPECT(one != two && getpgid(one) == one && getpgid(two) == two);
  finish_worker(&first);
  expect_group_gone(one);
  EXPECT(kill(two, 0) == 0);
  EXPECT(kill(second.worker, SIGTERM) == 0);
  wait_worker(&second);
  close(second.connection);
  expect_group_gone(two);
}

static void test_channel_shutdown(void) {
  struct sockaddr_un address = {.sun_family = AF_UNIX};
  snprintf(address.sun_path, sizeof(address.sun_path), "/tmp/nibrun-cron-%d", getpid());
  int descriptor = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0);
  EXPECT(descriptor >= 0);
  EXPECT(bind(descriptor, (struct sockaddr *)&address, sizeof(address)) == 0);
  EXPECT(listen(descriptor, 8) == 0);
  struct instance_config config = {.port = 8080};
  pid_t listener = fork();
  EXPECT(listener >= 0);
  if (listener == 0) {
    setpgid(0, 0);
    guest_cron_serve(&(struct guest_cron_listener){
        .descriptor = descriptor, .config = &config, .timeout_ms = GUEST_CRON_TIMEOUT_MS});
    _exit(0);
  }
  setpgid(listener, listener);
  close(descriptor);
  struct peer peer = {.worker = listener,
                      .connection = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0)};
  EXPECT(connect(peer.connection, (struct sockaddr *)&address, sizeof(address)) == 0);
  pid_t process = start_long_command(&peer);
  int pending = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  EXPECT(connect(pending, (struct sockaddr *)&address, sizeof(address)) == 0);
  EXPECT(send(pending, "N", 1, MSG_NOSIGNAL) == 1);
  guest_cron_stop(&(struct guest_cron){.process = listener});
  expect_group_gone(process);
  unsigned char byte;
  EXPECT(recv(peer.connection, &byte, 1, 0) == 0);
  close(peer.connection);
  close(pending);
  unlink(address.sun_path);
}

static void test_unacknowledged_output(bool invalid_ack) {
  struct peer peer = start_worker();
  struct request_builder builder = command_request("printf '%s' \"$$\"; exec sleep 30");
  append_u32(&(struct integer_append){.builder = &builder, .value = 0});
  send_request(&(struct request_send){.peer = &peer, .builder = &builder});
  struct frame frame = read_frame(&peer);
  EXPECT(frame.code == GUEST_CRON_STARTED);
  acknowledge(&peer);
  frame = read_frame(&peer);
  EXPECT(frame.code == GUEST_CRON_STDOUT);
  pid_t process = (pid_t)strtol((char *)frame.body, NULL, 10);
  if (invalid_ack) {
    unsigned char invalid = 0;
    EXPECT(send(peer.connection, &invalid, 1, MSG_NOSIGNAL) == 1);
  }
  int status;
  EXPECT(waitpid(peer.worker, &status, 0) == peer.worker);
  EXPECT(WIFEXITED(status) && WEXITSTATUS(status) == 0);
  EXPECT(kill(process, 0) < 0 && errno == ESRCH);
  unsigned char byte;
  EXPECT(recv(peer.connection, &byte, 1, 0) == 0);
  close(peer.connection);
}

static void test_signal_and_background_exit(void) {
  struct peer peer = start_worker();
  struct request_builder builder = command_request("kill -TERM $$");
  append_u32(&(struct integer_append){.builder = &builder, .value = 0});
  send_request(&(struct request_send){.peer = &peer, .builder = &builder});
  struct frame frame = read_frame(&peer);
  EXPECT(frame.code == GUEST_CRON_STARTED);
  acknowledge(&peer);
  frame = read_frame(&peer);
  EXPECT(frame.code == GUEST_CRON_EXIT && frame.body[3] == 0 && frame.body[7] == SIGTERM);
  finish_worker(&peer);

  peer = start_worker();
  builder = command_request("sleep 30 & printf '%s' \"$!\"; exit 9");
  append_u32(&(struct integer_append){.builder = &builder, .value = 0});
  send_request(&(struct request_send){.peer = &peer, .builder = &builder});
  frame = read_frame(&peer);
  EXPECT(frame.code == GUEST_CRON_STARTED);
  acknowledge(&peer);
  frame = read_frame(&peer);
  EXPECT(frame.code == GUEST_CRON_STDOUT);
  pid_t descendant = (pid_t)strtol((char *)frame.body, NULL, 10);
  acknowledge(&peer);
  frame = read_frame(&peer);
  EXPECT(frame.code == GUEST_CRON_EXIT && frame.body[3] == 9);
  finish_worker(&peer);
  EXPECT(waitpid(descendant, NULL, 0) == descendant);
}

static void expect_rejected(struct request_builder *builder) {
  struct peer peer = start_worker();
  send_request(&(struct request_send){.peer = &peer, .builder = builder});
  struct frame frame = read_frame(&peer);
  EXPECT(frame.code == GUEST_CRON_REJECTED && frame.length == 1 &&
         frame.body[0] == GUEST_CRON_MALFORMED);
  finish_worker(&peer);
}

static void test_malformed_requests(void) {
  struct request_builder builder = command_request("exit 0");
  append_u32(
      &(struct integer_append){.builder = &builder, .value = CRON_MAX_ENVIRONMENT_VARIABLES + 1});
  expect_rejected(&builder);
  builder = command_request("exit 0");
  append_u32(&(struct integer_append){.builder = &builder, .value = 1});
  append_string(&(struct string_append){.builder = &builder, .text = "1BAD=value"});
  expect_rejected(&builder);
  builder = command_request("exit 0");
  append_u32(&(struct integer_append){.builder = &builder, .value = 0});
  builder.bytes[GUEST_CRON_HEADER_BYTES + 4] = '\0';
  expect_rejected(&builder);
  builder = command_request("exit 0");
  append_u32(&(struct integer_append){.builder = &builder, .value = 0});
  builder.bytes[0] = 'X';
  expect_rejected(&builder);
  builder = command_request("exit 0");
  append_u32(&(struct integer_append){.builder = &builder, .value = 0});
  builder.bytes[4] = 99;
  expect_rejected(&builder);
  builder = command_request("exit 0");
  append_u32(&(struct integer_append){.builder = &builder, .value = 0});
  builder.bytes[builder.length++] = 'X';
  expect_rejected(&builder);
  struct peer peer = start_worker();
  builder = command_request("exit 0");
  builder.length = 5;
  append_u32(
      &(struct integer_append){.builder = &builder, .value = GUEST_CRON_REQUEST_MAX_BYTES + 1});
  EXPECT(send(peer.connection, builder.bytes, builder.length, MSG_NOSIGNAL) ==
         (ssize_t)builder.length);
  struct frame frame = read_frame(&peer);
  EXPECT(frame.code == GUEST_CRON_REJECTED && frame.body[0] == GUEST_CRON_MALFORMED);
  finish_worker(&peer);
  peer = start_worker();
  EXPECT(send(peer.connection, "NB", 2, MSG_NOSIGNAL) == 2);
  frame = read_frame(&peer);
  EXPECT(frame.code == GUEST_CRON_REJECTED && frame.body[0] == GUEST_CRON_MALFORMED);
  finish_worker(&peer);
}

int main(void) {
  alarm(30);
  EXPECT(mkdir(APP_DIR, 0755) == 0 || errno == EEXIST);
  EXPECT(prctl(PR_SET_CHILD_SUBREAPER, 1) == 0);
  supervise_block_signals();
  test_output_and_exit();
  test_maximum_environment();
  test_bounded_output();
  test_disconnect_preserves_other_run();
  test_channel_shutdown();
  test_unacknowledged_output(false);
  test_unacknowledged_output(true);
  test_signal_and_background_exit();
  test_malformed_requests();
  return EXPECT_REPORT("guest-cron");
}
