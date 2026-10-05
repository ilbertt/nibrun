#include <string.h>
#include "expect.h"
#include "../src/sqlite-wire.h"

int main(void) {
  unsigned char bytes[32] = {0};
  struct sqlite_wire writer = {.bytes = bytes, .length = sizeof(bytes)};
  sqlite_wire_write_integer(&writer, UINT64_MAX - 4, 8);
  sqlite_wire_write_string(&writer, "a\0b", 3);
  EXPECT(!writer.failed);
  struct sqlite_wire reader = {.bytes = bytes, .length = writer.position};
  EXPECT(sqlite_wire_integer(&reader, 8) == UINT64_MAX - 4);
  size_t length;
  const unsigned char *text = sqlite_wire_string(&reader, &length);
  EXPECT(length == 3 && memcmp(text, "a\0b", 3) == 0);
  EXPECT(sqlite_wire_bytes(&reader, 1) == NULL && reader.failed);
  writer.position = sizeof(bytes) - 1;
  sqlite_wire_write_integer(&writer, 1, 4);
  EXPECT(writer.failed);
  return EXPECT_REPORT("sqlite-wire");
}
