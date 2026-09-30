#include "guest-cron.h"

#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>

#include "clock.h"
#include "log.h"
#include "vsock.h"

/* Overlapping jobs get separate workers. A stuck host cannot fork without bound. */
#define MAX_WORKERS 64
#define PROCESS_POLL_MS 100

static volatile sig_atomic_t stopping;

struct transfer {
  int connection;
  unsigned char *bytes;
  size_t length;
  uint64_t deadline_ms;
  bool sending;
};

struct reply {
  const struct guest_cron_request *request;
  enum guest_cron_code code;
  unsigned char *body;
  size_t length;
};

struct decoded_command {
  const struct guest_cron_request *request;
  size_t length;
  unsigned char bytes[GUEST_CRON_REQUEST_MAX_BYTES + 1];
  char *command;
  char *environment[CRON_MAX_ENVIRONMENT_VARIABLES];
  size_t environment_count;
};

struct run {
  const struct guest_cron_request *request;
  pid_t process;
  int output;
  int errors;
  bool exited;
  bool completed;
};

struct incoming_connection {
  const struct guest_cron_request *request;
  int listener;
  size_t *workers;
};

struct uint32_field {
  unsigned char *bytes;
  uint32_t value;
};

struct refusal {
  const struct guest_cron_request *request;
  enum guest_cron_rejection reason;
};

struct string_field {
  const unsigned char *bytes;
  size_t length;
};

struct output_stream {
  struct run *run;
  int *descriptor;
  enum guest_cron_code code;
};

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
  return sigaction(SIGTERM, &action, NULL) == 0 && sigprocmask(SIG_UNBLOCK, &unblocked, NULL) == 0;
}

static uint32_t read_u32(const unsigned char *bytes) {
  return ((uint32_t)bytes[0] << 24) | ((uint32_t)bytes[1] << 16) | ((uint32_t)bytes[2] << 8) |
         bytes[3];
}

static void write_u32(const struct uint32_field *field) {
  unsigned char *bytes = field->bytes;
  uint32_t value = field->value;
  bytes[0] = (unsigned char)(value >> 24);
  bytes[1] = (unsigned char)(value >> 16);
  bytes[2] = (unsigned char)(value >> 8);
  bytes[3] = (unsigned char)value;
}

static bool transfer_bytes(const struct transfer *transfer) {
  size_t position = 0;
  while (!stopping && position < transfer->length) {
    int remaining = clock_remaining_ms(transfer->deadline_ms);
    if (remaining == 0) {
      return false;
    }
    struct pollfd waiting = {.fd = transfer->connection,
                             .events = transfer->sending ? POLLOUT : POLLIN};
    int ready = poll(&waiting, 1, remaining);
    if (ready < 0 && errno == EINTR) {
      continue;
    }
    if (ready <= 0) {
      return false;
    }
    ssize_t count = transfer->sending
                        ? send(transfer->connection, transfer->bytes + position,
                               transfer->length - position, MSG_NOSIGNAL | MSG_DONTWAIT)
                        : recv(transfer->connection, transfer->bytes + position,
                               transfer->length - position, MSG_DONTWAIT);
    if (count < 0 && (errno == EINTR || errno == EAGAIN)) {
      continue;
    }
    if (count <= 0) {
      return false;
    }
    position += (size_t)count;
  }
  return !stopping;
}

static bool send_reply(const struct reply *reply) {
  unsigned char header[GUEST_CRON_HEADER_BYTES];
  memcpy(header, GUEST_CRON_MAGIC, 4);
  header[4] = reply->code;
  write_u32(&(struct uint32_field){.bytes = header + 5, .value = (uint32_t)reply->length});
  struct transfer transfer = {.connection = reply->request->connection,
                              .bytes = header,
                              .length = sizeof(header),
                              .deadline_ms = clock_monotonic_ms() + reply->request->timeout_ms,
                              .sending = true};
  if (!transfer_bytes(&transfer)) {
    return false;
  }
  transfer.bytes = reply->body;
  transfer.length = reply->length;
  if (!transfer_bytes(&transfer)) {
    return false;
  }
  if (reply->code == GUEST_CRON_EXIT || reply->code == GUEST_CRON_REJECTED) {
    return true;
  }
  unsigned char acknowledgement;
  transfer.bytes = &acknowledgement;
  transfer.length = 1;
  transfer.sending = false;
  return transfer_bytes(&transfer) && acknowledgement == GUEST_CRON_ACK;
}

static void reject_request(const struct refusal *refusal) {
  const struct guest_cron_request *request = refusal->request;
  unsigned char body = refusal->reason;
  send_reply(
      &(struct reply){.request = request, .code = GUEST_CRON_REJECTED, .body = &body, .length = 1});
}

static bool environment_name(const struct string_field *field) {
  const unsigned char *bytes = field->bytes;
  size_t length = field->length;
  for (size_t index = 0; index < length; index++) {
    unsigned char byte = bytes[index];
    if (byte == '=') {
      return index > 0;
    }
    if (!((byte >= 'a' && byte <= 'z') || (byte >= 'A' && byte <= 'Z') || byte == '_' ||
          (index > 0 && byte >= '0' && byte <= '9'))) {
      return false;
    }
  }
  return false;
}

static bool decode_command(struct decoded_command *command) {
  size_t length = command->length;
  size_t position = 0;
  unsigned char *ends[CRON_MAX_ENVIRONMENT_VARIABLES + 1];
  size_t count = 1;
  for (size_t index = 0; index < count; index++) {
    if (length - position < 4) {
      return false;
    }
    uint32_t field_length = read_u32(command->bytes + position);
    position += 4;
    if (field_length == 0 || field_length > length - position ||
        memchr(command->bytes + position, '\0', field_length) != NULL) {
      return false;
    }
    char *field = (char *)(command->bytes + position);
    if (index == 0) {
      if (field_length > CRON_MAX_COMMAND_BYTES || length - position - field_length < 4) {
        return false;
      }
      command->command = field;
    } else {
      if (!environment_name(
              &(struct string_field){.bytes = command->bytes + position, .length = field_length})) {
        return false;
      }
      command->environment[index - 1] = field;
    }
    position += field_length;
    ends[index] = command->bytes + position;
    if (index == 0) {
      command->environment_count = read_u32(command->bytes + position);
      if (command->environment_count > CRON_MAX_ENVIRONMENT_VARIABLES) {
        return false;
      }
      count += command->environment_count;
      position += 4;
    }
  }
  if (position != length) {
    return false;
  }
  /* Terminators overwrite already-decoded length prefixes, never field bytes. */
  for (size_t index = 0; index < count; index++) {
    *ends[index] = '\0';
  }
  return true;
}

static bool receive_command(struct decoded_command *command) {
  const struct guest_cron_request *request = command->request;
  unsigned char header[GUEST_CRON_HEADER_BYTES];
  struct transfer transfer = {.connection = request->connection,
                              .bytes = header,
                              .length = sizeof(header),
                              .deadline_ms = clock_monotonic_ms() + request->timeout_ms};
  if (!transfer_bytes(&transfer) || memcmp(header, GUEST_CRON_MAGIC, 4) != 0 ||
      header[4] != GUEST_CRON_RUN) {
    return false;
  }
  transfer.length = read_u32(header + 5);
  if (transfer.length > GUEST_CRON_REQUEST_MAX_BYTES) {
    return false;
  }
  transfer.bytes = command->bytes;
  command->length = transfer.length;
  return transfer_bytes(&transfer) && decode_command(command);
}

static void close_pipe(int *descriptor) {
  if (*descriptor >= 0) {
    close(*descriptor);
    *descriptor = -1;
  }
}

static bool forward_pipe(const struct output_stream *stream) {
  struct run *run = stream->run;
  int *descriptor = stream->descriptor;
  unsigned char bytes[GUEST_CRON_OUTPUT_MAX_BYTES];
  ssize_t count = read(*descriptor, bytes, sizeof(bytes));
  if (count < 0) {
    return errno == EINTR || errno == EAGAIN;
  }
  if (count == 0) {
    close_pipe(descriptor);
    return true;
  }
  return send_reply(&(struct reply){
      .request = run->request, .code = stream->code, .body = bytes, .length = (size_t)count});
}

static bool collect_output(struct run *run) {
  while (!stopping) {
    siginfo_t child = {0};
    if (!run->exited && waitid(P_PID, run->process, &child, WEXITED | WNOHANG | WNOWAIT) < 0) {
      return false;
    }
    if (!run->exited && child.si_pid == run->process) {
      /* A background descendant must not keep a finished run's pipes open forever.
       * Keep the leader unreaped until its group is cancelled to prevent PID reuse. */
      kill(-run->process, SIGKILL);
      run->exited = true;
    }
    if (run->exited && run->output < 0 && run->errors < 0) {
      return true;
    }
    struct pollfd waiting[] = {{.fd = run->request->connection, .events = POLLIN},
                               {.fd = run->output, .events = POLLIN},
                               {.fd = run->errors, .events = POLLIN}};
    int ready = poll(waiting, 3, PROCESS_POLL_MS);
    if (ready < 0 && errno == EINTR) {
      continue;
    }
    if (ready < 0 || waiting[0].revents != 0) {
      return false;
    }
    if (waiting[1].revents != 0 &&
        !forward_pipe(&(struct output_stream){
            .run = run, .descriptor = &run->output, .code = GUEST_CRON_STDOUT})) {
      return false;
    }
    if (waiting[2].revents != 0 &&
        !forward_pipe(&(struct output_stream){
            .run = run, .descriptor = &run->errors, .code = GUEST_CRON_STDERR})) {
      return false;
    }
  }
  return false;
}

static void finish_run(struct run *run) {
  if (!run->exited) {
    /* The leader may not have reached setsid yet when the connection disappears. */
    kill(run->process, SIGKILL);
    kill(-run->process, SIGKILL);
  }
  int status = 0;
  pid_t reaped;
  do {
    reaped = waitpid(run->process, &status, 0);
  } while (reaped < 0 && errno == EINTR);
  close_pipe(&run->output);
  close_pipe(&run->errors);
  if (run->completed && reaped == run->process) {
    unsigned char body[8];
    write_u32(&(struct uint32_field){.bytes = body,
                                     .value = WIFEXITED(status) ? WEXITSTATUS(status) : 0});
    write_u32(&(struct uint32_field){.bytes = body + 4,
                                     .value = WIFSIGNALED(status) ? WTERMSIG(status) : 0});
    send_reply(&(struct reply){
        .request = run->request, .code = GUEST_CRON_EXIT, .body = body, .length = sizeof(body)});
  }
}

static void execute_command(const struct decoded_command *command) {
  const struct guest_cron_request *request = command->request;
  int output[2] = {-1, -1};
  int errors[2] = {-1, -1};
  if (pipe2(output, O_CLOEXEC) < 0 || pipe2(errors, O_CLOEXEC) < 0 ||
      fcntl(output[0], F_SETFL, O_NONBLOCK) < 0 || fcntl(errors[0], F_SETFL, O_NONBLOCK) < 0) {
    close_pipe(&output[0]);
    close_pipe(&output[1]);
    close_pipe(&errors[0]);
    close_pipe(&errors[1]);
    reject_request(&(struct refusal){.request = request, .reason = GUEST_CRON_SPAWN_FAILED});
    return;
  }
  struct cron_command launch = {.config = request->config,
                                .command = command->command,
                                .environment = command->environment,
                                .environment_count = command->environment_count,
                                .output = output[1],
                                .errors = errors[1]};
  struct run run = {.request = request,
                    .process = cron_command_start(&launch),
                    .output = output[0],
                    .errors = errors[0]};
  close(output[1]);
  close(errors[1]);
  if (run.process < 0) {
    close_pipe(&run.output);
    close_pipe(&run.errors);
    reject_request(&(struct refusal){.request = request, .reason = GUEST_CRON_SPAWN_FAILED});
    return;
  }
  run.completed = send_reply(&(struct reply){.request = request, .code = GUEST_CRON_STARTED}) &&
                  collect_output(&run);
  finish_run(&run);
}

void guest_cron_answer(const struct guest_cron_request *request) {
  if (!prepare_signals()) {
    return;
  }
  struct decoded_command command = {.request = request};
  if (!receive_command(&command)) {
    reject_request(&(struct refusal){.request = request, .reason = GUEST_CRON_MALFORMED});
    return;
  }
  execute_command(&command);
}

static int listen_on_cron_port(void) {
  int listener = socket(AF_VSOCK, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0);
  if (listener < 0) {
    return -1;
  }
  struct vsock_address address = {
      .family = AF_VSOCK, .port = GUEST_CRON_VSOCK_PORT, .cid = VMADDR_CID_ANY};
  if (bind(listener, (const struct sockaddr *)&address, sizeof(address)) < 0 ||
      listen(listener, MAX_WORKERS) < 0) {
    close(listener);
    return -1;
  }
  return listener;
}

static void serve_connection(const struct incoming_connection *incoming) {
  const struct guest_cron_request *request = incoming->request;
  if (*incoming->workers >= MAX_WORKERS) {
    reject_request(&(struct refusal){.request = request, .reason = GUEST_CRON_BUSY});
    return;
  }
  /* TERM stays pending until the worker has installed its cleanup handler. */
  sigset_t blocked;
  sigset_t previous;
  sigemptyset(&blocked);
  sigaddset(&blocked, SIGTERM);
  if (sigprocmask(SIG_BLOCK, &blocked, &previous) < 0) {
    reject_request(&(struct refusal){.request = request, .reason = GUEST_CRON_SPAWN_FAILED});
    return;
  }
  pid_t parent = getpid();
  pid_t process = fork();
  if (process == 0) {
    close(incoming->listener);
    if (prctl(PR_SET_PDEATHSIG, SIGTERM) < 0 || getppid() != parent) {
      _exit(1);
    }
    guest_cron_answer(request);
    close(request->connection);
    _exit(0);
  }
  sigprocmask(SIG_SETMASK, &previous, NULL);
  if (process < 0) {
    reject_request(&(struct refusal){.request = request, .reason = GUEST_CRON_SPAWN_FAILED});
    return;
  }
  (*incoming->workers)++;
}

void guest_cron_serve(const struct guest_cron_listener *channel) {
  if (!prepare_signals()) {
    close(channel->descriptor);
    return;
  }
  int listener = channel->descriptor;
  size_t workers = 0;
  while (!stopping) {
    while (waitpid(-1, NULL, WNOHANG) > 0) {
      workers--;
    }
    struct pollfd waiting = {.fd = listener, .events = POLLIN};
    if (poll(&waiting, 1, PROCESS_POLL_MS) <= 0 || stopping) {
      continue;
    }
    int connection = accept4(listener, NULL, NULL, SOCK_CLOEXEC);
    if (connection < 0) {
      continue;
    }
    struct guest_cron_request request = {
        .connection = connection, .config = channel->config, .timeout_ms = channel->timeout_ms};
    serve_connection(&(struct incoming_connection){
        .request = &request, .listener = listener, .workers = &workers});
    close(connection);
  }
  close(listener);
  kill(-getpgrp(), SIGTERM);
  while (waitpid(-1, NULL, 0) > 0 || errno == EINTR) {
  }
}

void guest_cron_start(struct guest_cron *cron) {
  pid_t parent = getpid();
  pid_t process = fork();
  if (process == 0) {
    if (setpgid(0, 0) < 0 || prctl(PR_SET_PDEATHSIG, SIGTERM) < 0 || getppid() != parent) {
      _exit(1);
    }
    int listener = listen_on_cron_port();
    if (listener < 0) {
      log_errno("could not listen on the cron socket");
      _exit(1);
    }
    log_line("the cron channel is listening on vsock port %u", GUEST_CRON_VSOCK_PORT);
    guest_cron_serve(&(struct guest_cron_listener){
        .descriptor = listener, .config = cron->config, .timeout_ms = GUEST_CRON_TIMEOUT_MS});
    _exit(0);
  }
  if (process < 0) {
    log_errno("could not start the cron channel");
  } else {
    setpgid(process, process);
  }
  cron->process = process;
}

void guest_cron_stop(const struct guest_cron *cron) {
  if (cron->process <= 0) {
    return;
  }
  /* Workers catch TERM and cancel their commands' separate process groups before
   * the listener exits, so no cron keeps the data mount busy during shutdown. */
  kill(-cron->process, SIGTERM);
  while (waitpid(cron->process, NULL, 0) < 0 && errno == EINTR) {
  }
}
