#include "crontab.h"

#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

#include "vsock.h"

#define CRONTAB_TIMEOUT_SECONDS 5
#define CRONTAB_MAGIC_BYTES (sizeof(CRONTAB_MAGIC) - 1)
#define CRONTAB_LENGTH_OFFSET (CRONTAB_MAGIC_BYTES + 1)

struct transfer {
  int descriptor;
  const void *bytes;
  size_t length;
  bool socket;
};

static bool write_all(const struct transfer *transfer) {
  size_t sent = 0;
  while (sent < transfer->length) {
    const unsigned char *bytes = transfer->bytes;
    ssize_t count = transfer->socket
                        ? send(transfer->descriptor, bytes + sent, transfer->length - sent, MSG_NOSIGNAL)
                        : write(transfer->descriptor, bytes + sent, transfer->length - sent);
    if (count < 0 && errno == EINTR) {
      continue;
    }
    if (count <= 0) {
      return false;
    }
    sent += (size_t)count;
  }
  return true;
}

static bool read_all(const struct transfer *transfer) {
  size_t received = 0;
  while (received < transfer->length) {
    unsigned char *bytes = (unsigned char *)transfer->bytes;
    ssize_t count = read(transfer->descriptor, bytes + received, transfer->length - received);
    if (count < 0 && errno == EINTR) {
      continue;
    }
    if (count <= 0) {
      return false;
    }
    received += (size_t)count;
  }
  return true;
}

bool crontab_read_source(struct crontab_source *source) {
  if (source->descriptor < 0) {
    return true;
  }
  for (;;) {
    unsigned char extra;
    bool full = source->length == CRONTAB_MAX_BYTES;
    void *destination = full ? &extra : source->bytes + source->length;
    size_t capacity = full ? 1 : CRONTAB_MAX_BYTES - source->length;
    ssize_t count = read(source->descriptor, destination, capacity);
    if (count < 0 && errno == EINTR) {
      continue;
    }
    if (count < 0 || (full && count > 0)) {
      return false;
    }
    if (count == 0) {
      return true;
    }
    source->length += (size_t)count;
  }
}

struct crontab_options crontab_parse_options(const struct crontab_arguments *arguments) {
  struct crontab_options options = {.verb = CRONTAB_REPLACE, .read_input = true};
  if (arguments->count != 2) {
    return options;
  }
  const char *argument = arguments->values[1];
  if (strcmp(argument, "-l") == 0) {
    options.verb = CRONTAB_LIST;
    options.read_input = false;
  } else if (strcmp(argument, "-r") == 0) {
    options.read_input = false;
  } else if (strcmp(argument, "-") != 0) {
    if (argument[0] == '-') {
      return options;
    }
    options.path = argument;
  }
  options.valid = true;
  return options;
}

int crontab_exchange(const struct crontab_exchange *exchange) {
  unsigned char body[CRONTAB_MAX_BYTES];
  if (exchange->length > CRONTAB_MAX_BYTES ||
      (exchange->verb == CRONTAB_LIST && exchange->length != 0)) {
    dprintf(exchange->errors, "crontab: invalid request\n");
    return 1;
  }
  unsigned char header[CRONTAB_HEADER_BYTES] = {0};
  memcpy(header, CRONTAB_MAGIC, CRONTAB_MAGIC_BYTES);
  header[CRONTAB_MAGIC_BYTES] = (unsigned char)exchange->verb;
  uint32_t length = (uint32_t)exchange->length;
  for (size_t index = 0; index < sizeof(length); index++) {
    header[CRONTAB_LENGTH_OFFSET + index] = (unsigned char)(length >> (8 * (sizeof(length) - index - 1)));
  }
  struct transfer transfer = {
      .descriptor = exchange->connection, .bytes = header, .length = sizeof(header), .socket = true};
  if (!write_all(&transfer)) {
    goto transport_failed;
  }
  transfer.bytes = exchange->source;
  transfer.length = exchange->length;
  if (!write_all(&transfer)) {
    goto transport_failed;
  }
  transfer.bytes = header;
  transfer.length = sizeof(header);
  if (!read_all(&transfer)) {
    goto transport_failed;
  }
  length = 0;
  for (size_t index = 0; index < sizeof(length); index++) {
    length = (length << 8) | header[CRONTAB_LENGTH_OFFSET + index];
  }
  unsigned char status = header[CRONTAB_MAGIC_BYTES];
  if (memcmp(header, CRONTAB_MAGIC, CRONTAB_MAGIC_BYTES) != 0 ||
      status > CRONTAB_REJECTED || length > sizeof(body) ||
      (status == CRONTAB_OK && exchange->verb == CRONTAB_REPLACE && length != 0)) {
    dprintf(exchange->errors, "crontab: malformed agent response\n");
    return 1;
  }
  transfer.bytes = body;
  transfer.length = length;
  if (!read_all(&transfer)) {
    goto transport_failed;
  }
  transfer.descriptor = status == CRONTAB_OK ? exchange->output : exchange->errors;
  transfer.socket = false;
  if (!write_all(&transfer)) {
    return 1;
  }
  if (status == CRONTAB_REJECTED) {
    dprintf(exchange->errors, "\n");
    return 1;
  }
  return 0;

transport_failed:
  dprintf(exchange->errors, "crontab: agent connection failed; replacement was not confirmed\n");
  return 1;
}

static int connect_agent(void) {
  int connection = socket(AF_VSOCK, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (connection < 0) {
    return -1;
  }
  struct timeval timeout = {.tv_sec = CRONTAB_TIMEOUT_SECONDS};
  struct vsock_address address = {
      .family = AF_VSOCK, .port = CRON_REGISTRATION_VSOCK_PORT, .cid = VMADDR_CID_HOST};
  if (setsockopt(connection, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout)) < 0 ||
      setsockopt(connection, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout)) < 0 ||
      connect(connection, (const struct sockaddr *)&address, sizeof(address)) < 0) {
    close(connection);
    return -1;
  }
  return connection;
}

int crontab_main(const struct crontab_arguments *arguments) {
  struct crontab_options options = crontab_parse_options(arguments);
  if (!options.valid) {
    fprintf(stderr, "Usage: crontab FILE | crontab - | crontab -l | crontab -r\n");
    return 1;
  }
  int input = options.read_input ? STDIN_FILENO : -1;
  if (options.path != NULL) {
    input = open(options.path, O_RDONLY | O_CLOEXEC);
    if (input < 0) {
      fprintf(stderr, "crontab: cannot open input file\n");
      return 1;
    }
  }
  struct crontab_source source = {.descriptor = input};
  bool source_ready = crontab_read_source(&source);
  if (options.path != NULL) {
    close(input);
  }
  if (!source_ready) {
    fprintf(stderr, "crontab: cannot read input or table exceeds %d bytes\n", CRONTAB_MAX_BYTES);
    return 1;
  }
  int connection = connect_agent();
  if (connection < 0) {
    fprintf(stderr, "crontab: cannot connect to the agent\n");
    return 1;
  }
  struct crontab_exchange exchange = {.connection = connection,
                                     .source = source.bytes,
                                     .length = source.length,
                                     .output = STDOUT_FILENO,
                                     .errors = STDERR_FILENO,
                                     .verb = options.verb};
  int result = crontab_exchange(&exchange);
  close(connection);
  return result;
}
