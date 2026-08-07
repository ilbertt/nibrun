#ifndef NIBRUN_CLOCK_H
#define NIBRUN_CLOCK_H

#include <stdint.h>

/* CLOCK_MONOTONIC, so a guest whose wall clock is stepped by NTP does not shorten
 * or extend a deadline it is already waiting on. */
uint64_t clock_monotonic_ms(void);

/* What is left until `deadline_ms`, clamped to what poll(2) takes. */
int clock_remaining_ms(uint64_t deadline_ms);

#endif
