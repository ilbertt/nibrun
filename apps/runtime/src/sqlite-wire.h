#ifndef NIBRUN_SQLITE_WIRE_H
#define NIBRUN_SQLITE_WIRE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define SQLITE_WIRE_MAGIC "NBS1"
#define SQLITE_WIRE_HEADER_BYTES 9
#define SQLITE_WIRE_MAX_BYTES 65536

/* All integers and IEEE754 doubles are big-endian. A string is a uint32 byte
 * length followed by bytes. One socket owns one SQLite connection, so frames
 * are strictly sequential and have no request ID. */
enum sqlite_wire_operation {
  SQLITE_WIRE_OPEN = 0,
  SQLITE_WIRE_EXECUTE = 1,
  SQLITE_WIRE_DESCRIBE = 2,
  SQLITE_WIRE_SEQUENCE = 3,
  SQLITE_WIRE_CLOSE = 4,
  SQLITE_WIRE_OK = 128,
  SQLITE_WIRE_RESULT = 129,
  SQLITE_WIRE_DESCRIPTION = 130,
  SQLITE_WIRE_ERROR = 255,
};

enum sqlite_wire_type {
  SQLITE_WIRE_NULL = 0,
  SQLITE_WIRE_INTEGER = 1,
  SQLITE_WIRE_FLOAT = 2,
  SQLITE_WIRE_TEXT = 3,
  SQLITE_WIRE_BLOB = 4,
};

struct sqlite_wire {
  unsigned char *bytes;
  size_t length;
  size_t position;
  bool failed;
};

uint64_t sqlite_wire_integer(struct sqlite_wire *wire, size_t width);
const unsigned char *sqlite_wire_bytes(struct sqlite_wire *wire, size_t length);
const unsigned char *sqlite_wire_string(struct sqlite_wire *wire, size_t *length);
void sqlite_wire_write_integer(struct sqlite_wire *wire, uint64_t value, size_t width);
void sqlite_wire_write_bytes(struct sqlite_wire *wire, const void *bytes, size_t length);
void sqlite_wire_write_string(struct sqlite_wire *wire, const void *bytes, size_t length);

#endif
