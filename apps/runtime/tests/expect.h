#ifndef NIBRUN_EXPECT_H
#define NIBRUN_EXPECT_H

#include <stdio.h>

static int expect_checks;
static int expect_failures;

#define EXPECT(condition)                                                  \
  do {                                                                     \
    expect_checks++;                                                       \
    if (!(condition)) {                                                    \
      expect_failures++;                                                   \
      fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #condition); \
    }                                                                      \
  } while (0)

#define EXPECT_REPORT(suite)                                                                    \
  (fprintf(stderr, "%s: %d checks, %d failures\n", (suite), expect_checks, expect_failures) < 0 \
       ? 1                                                                                      \
       : (expect_failures == 0 ? 0 : 1))

#endif
