#ifndef NIBRUN_GUEST_SQLITE_H
#define NIBRUN_GUEST_SQLITE_H
#include <stdint.h>
#include <sys/types.h>

struct guest_sqlite {
  pid_t process;
  const char *mount_point;
};
struct guest_sqlite_request {
  int connection;
  const char *mount_point;
  uint32_t timeout_ms;
};
struct guest_sqlite_listener {
  int descriptor;
  const char *mount_point;
  uint32_t timeout_ms;
};
void guest_sqlite_start(struct guest_sqlite *channel);
void guest_sqlite_stop(const struct guest_sqlite *channel);
void guest_sqlite_refuse(int connection);
void guest_sqlite_answer(const struct guest_sqlite_request *request);
void guest_sqlite_serve(const struct guest_sqlite_listener *channel);
#endif
