#include "clock.h"

#include <limits.h>
#include <time.h>

#define MS_PER_SECOND 1000
#define NS_PER_MS 1000000L

uint64_t clock_monotonic_ms(void) {
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  return (uint64_t)now.tv_sec * MS_PER_SECOND + (uint64_t)now.tv_nsec / (uint64_t)NS_PER_MS;
}

int clock_remaining_ms(uint64_t deadline_ms) {
  uint64_t now = clock_monotonic_ms();
  uint64_t left = deadline_ms > now ? deadline_ms - now : 0;
  return left > INT_MAX ? INT_MAX : (int)left;
}
