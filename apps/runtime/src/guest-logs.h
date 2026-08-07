#ifndef NIBRUN_GUEST_LOGS_H
#define NIBRUN_GUEST_LOGS_H

#include <stdint.h>

#include "supervise.h"

struct guest_log_forwarder {
  int descriptor;
  int connection_state;
  uint64_t retry_after_ms;
  uint64_t dropped_bytes;
};

void guest_logs_init(struct guest_log_forwarder *forwarder);
void guest_logs_close(struct guest_log_forwarder *forwarder);
struct tenant_output guest_logs_tenant_output(struct guest_log_forwarder *forwarder);

#endif
