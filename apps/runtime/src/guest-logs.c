#include "guest-logs.h"

#include <arpa/inet.h>
#include <errno.h>
#include <limits.h>
#include <poll.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/uio.h>
#include <unistd.h>

#include "clock.h"
#include "vsock.h"

#define RECONNECT_DELAY_MS 250
#define FRAME_HEADER_BYTES 9
#define GAP_PAYLOAD_BYTES 8

enum connection_state {
  CONNECTION_DISCONNECTED,
  CONNECTION_CONNECTING,
  CONNECTION_CONNECTED,
};

enum frame_kind {
  FRAME_STDOUT = 1,
  FRAME_STDERR = 2,
  FRAME_GAP = 3,
};

static const unsigned char FRAME_MAGIC[] = {'N', 'B', 'L', '1'};

static void disconnect(struct guest_log_forwarder *forwarder) {
  if (forwarder->descriptor >= 0) {
    close(forwarder->descriptor);
  }
  forwarder->descriptor = -1;
  forwarder->connection_state = CONNECTION_DISCONNECTED;
  forwarder->retry_after_ms = clock_monotonic_ms() + RECONNECT_DELAY_MS;
}

static void start_connection(struct guest_log_forwarder *forwarder) {
  if (clock_monotonic_ms() < forwarder->retry_after_ms) {
    return;
  }

  int descriptor = socket(AF_VSOCK, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0);
  if (descriptor < 0) {
    forwarder->retry_after_ms = clock_monotonic_ms() + RECONNECT_DELAY_MS;
    return;
  }

  struct vsock_address address = {
      .family = AF_VSOCK,
      .port = TENANT_LOG_VSOCK_PORT,
      .cid = VMADDR_CID_HOST,
  };
  forwarder->descriptor = descriptor;
  if (connect(descriptor, (const struct sockaddr *)&address, sizeof(address)) == 0) {
    forwarder->connection_state = CONNECTION_CONNECTED;
    return;
  }
  if (errno == EINPROGRESS) {
    forwarder->connection_state = CONNECTION_CONNECTING;
    return;
  }
  disconnect(forwarder);
}

static bool connection_ready(struct guest_log_forwarder *forwarder) {
  if (forwarder->connection_state == CONNECTION_DISCONNECTED) {
    start_connection(forwarder);
  }
  if (forwarder->connection_state == CONNECTION_CONNECTED) {
    return true;
  }
  if (forwarder->connection_state != CONNECTION_CONNECTING) {
    return false;
  }

  struct pollfd pending = {.fd = forwarder->descriptor, .events = POLLOUT};
  if (poll(&pending, 1, 0) <= 0) {
    return false;
  }

  int error_number = 0;
  socklen_t error_size = sizeof(error_number);
  if (getsockopt(forwarder->descriptor, SOL_SOCKET, SO_ERROR, &error_number, &error_size) < 0 ||
      error_number != 0) {
    disconnect(forwarder);
    return false;
  }
  forwarder->connection_state = CONNECTION_CONNECTED;
  return true;
}

static bool send_frame(struct guest_log_forwarder *forwarder, enum frame_kind kind,
                       const unsigned char *payload, size_t payload_length) {
  if (payload_length > UINT32_MAX) {
    return false;
  }

  unsigned char header[FRAME_HEADER_BYTES];
  memcpy(header, FRAME_MAGIC, sizeof(FRAME_MAGIC));
  header[sizeof(FRAME_MAGIC)] = (unsigned char)kind;
  uint32_t encoded_length = htonl((uint32_t)payload_length);
  memcpy(header + sizeof(FRAME_MAGIC) + 1, &encoded_length, sizeof(encoded_length));

  struct iovec parts[] = {
      {.iov_base = header, .iov_len = sizeof(header)},
      {.iov_base = (void *)payload, .iov_len = payload_length},
  };
  struct msghdr message = {
      .msg_iov = parts,
      .msg_iovlen = sizeof(parts) / sizeof(parts[0]),
  };
  ssize_t written = sendmsg(forwarder->descriptor, &message, MSG_DONTWAIT | MSG_NOSIGNAL);
  return written == (ssize_t)(sizeof(header) + payload_length);
}

static void encode_u64(uint64_t value, unsigned char encoded[GAP_PAYLOAD_BYTES]) {
  for (size_t index = 0; index < GAP_PAYLOAD_BYTES; index++) {
    encoded[GAP_PAYLOAD_BYTES - index - 1] = (unsigned char)(value & UCHAR_MAX);
    value >>= CHAR_BIT;
  }
}

static void add_dropped_bytes(struct guest_log_forwarder *forwarder, size_t count) {
  uint64_t room = UINT64_MAX - forwarder->dropped_bytes;
  forwarder->dropped_bytes += count > room ? room : count;
}

static void forward_output(void *context, enum tenant_output_stream stream, const unsigned char *bytes,
                           size_t length) {
  struct guest_log_forwarder *forwarder = context;
  if (!connection_ready(forwarder)) {
    add_dropped_bytes(forwarder, length);
    return;
  }

  if (forwarder->dropped_bytes > 0) {
    unsigned char gap[GAP_PAYLOAD_BYTES];
    encode_u64(forwarder->dropped_bytes, gap);
    if (!send_frame(forwarder, FRAME_GAP, gap, sizeof(gap))) {
      disconnect(forwarder);
      add_dropped_bytes(forwarder, length);
      return;
    }
    forwarder->dropped_bytes = 0;
  }

  enum frame_kind kind = stream == TENANT_OUTPUT_STDOUT ? FRAME_STDOUT : FRAME_STDERR;
  if (!send_frame(forwarder, kind, bytes, length)) {
    disconnect(forwarder);
    add_dropped_bytes(forwarder, length);
  }
}

/* A host that goes away leaves this side looking connected: nothing fails until something is
 * written, and a tenant that is not printing never writes. So the connection is asked about
 * rather than waited on — a peek costs one syscall and turns the agent restarting into something
 * the guest notices before it has anything to say, instead of a first line lost proving it. */
static void service_connection(void *context) {
  struct guest_log_forwarder *forwarder = context;
  if (forwarder->connection_state == CONNECTION_CONNECTED) {
    unsigned char probe;
    ssize_t seen = recv(forwarder->descriptor, &probe, sizeof(probe), MSG_DONTWAIT | MSG_PEEK);
    if (seen == 0 || (seen < 0 && errno != EAGAIN && errno != EWOULDBLOCK)) {
      disconnect(forwarder);
    }
  }
  connection_ready(forwarder);
}

void guest_logs_init(struct guest_log_forwarder *forwarder) {
  *forwarder = (struct guest_log_forwarder){
      .descriptor = -1,
      .connection_state = CONNECTION_DISCONNECTED,
  };
  start_connection(forwarder);
}

void guest_logs_close(struct guest_log_forwarder *forwarder) {
  if (forwarder->descriptor >= 0) {
    close(forwarder->descriptor);
  }
  forwarder->descriptor = -1;
  forwarder->connection_state = CONNECTION_DISCONNECTED;
}

struct tenant_output guest_logs_tenant_output(struct guest_log_forwarder *forwarder) {
  return (struct tenant_output){
      .write = forward_output, .service = service_connection, .context = forwarder};
}
