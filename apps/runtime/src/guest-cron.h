#ifndef NIBRUN_GUEST_CRON_H
#define NIBRUN_GUEST_CRON_H

#include <stdint.h>
#include <sys/types.h>

#include "config.h"
#include "cron-command.h"
#include "crontab.h"

/* One connection owns one run. NBR1 frames have a code byte and a big-endian
 * uint32 body length. RUN contains a length-prefixed command, a uint32 environment
 * count, then length-prefixed NAME=value entries. The crontab source bound plus
 * framing overhead admits every registered job without an unbounded buffer. */
#define GUEST_CRON_MAGIC "NBR1"
#define GUEST_CRON_HEADER_BYTES 9
#define GUEST_CRON_REQUEST_MAX_BYTES (CRONTAB_MAX_BYTES + (CRON_MAX_ENVIRONMENT_VARIABLES + 2) * 4)
#define GUEST_CRON_OUTPUT_MAX_BYTES 4096
#define GUEST_CRON_TIMEOUT_MS 5000

/* STARTED and each output frame need this acknowledgement before another frame
 * can be sent. This bounds pending output in the host as well as in the guest. */
#define GUEST_CRON_ACK 0x06

enum guest_cron_code {
  GUEST_CRON_RUN = 0,
  GUEST_CRON_STARTED = 1,
  GUEST_CRON_STDOUT = 2,
  GUEST_CRON_STDERR = 3,
  /* Body: uint32 exit code, uint32 signal. Exit code is zero when signalled. */
  GUEST_CRON_EXIT = 4,
  /* Body: one guest_cron_rejection byte. No command was started. */
  GUEST_CRON_REJECTED = 5,
};

enum guest_cron_rejection {
  GUEST_CRON_MALFORMED = 1,
  GUEST_CRON_SPAWN_FAILED = 2,
  GUEST_CRON_BUSY = 3,
};

struct guest_cron {
  pid_t process;
  const struct instance_config *config;
};

struct guest_cron_request {
  int connection;
  const struct instance_config *config;
  uint32_t timeout_ms;
};

struct guest_cron_listener {
  int descriptor;
  const struct instance_config *config;
  uint32_t timeout_ms;
};

void guest_cron_start(struct guest_cron *cron);
void guest_cron_stop(const struct guest_cron *cron);
/* Runs in a worker process; exposed for socketpair tests without AF_VSOCK. */
void guest_cron_answer(const struct guest_cron_request *request);
/* Owns the listener descriptor; allows lifecycle tests over a Unix socket. */
void guest_cron_serve(const struct guest_cron_listener *listener);

#endif
