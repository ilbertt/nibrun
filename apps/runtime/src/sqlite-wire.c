#include "sqlite-wire.h"

#include <string.h>

const unsigned char* sqlite_wire_bytes(struct sqlite_wire* wire, size_t length) {
  if (wire->failed || length > wire->length - wire->position) {
    wire->failed = true;
    return NULL;
  }
  const unsigned char* bytes = wire->bytes + wire->position;
  wire->position += length;
  return bytes;
}

uint64_t sqlite_wire_integer(struct sqlite_wire* wire, size_t width) {
  const unsigned char* bytes = sqlite_wire_bytes(wire, width);
  uint64_t value = 0;
  if (bytes != NULL) {
    for (size_t index = 0; index < width; index++) {
      value = (value << 8) | bytes[index];
    }
  }
  return value;
}

const unsigned char* sqlite_wire_string(struct sqlite_wire* wire, size_t* length) {
  *length = (size_t)sqlite_wire_integer(wire, 4);
  return sqlite_wire_bytes(wire, *length);
}

void sqlite_wire_write_bytes(struct sqlite_wire* wire, const void* bytes, size_t length) {
  if (wire->failed || length > wire->length - wire->position) {
    wire->failed = true;
    return;
  }
  if (length != 0) {
    memcpy(wire->bytes + wire->position, bytes, length);
  }
  wire->position += length;
}

void sqlite_wire_write_integer(struct sqlite_wire* wire, uint64_t value, size_t width) {
  unsigned char bytes[8];
  if (width > sizeof(bytes)) {
    wire->failed = true;
    return;
  }
  for (size_t index = width; index > 0; index--) {
    bytes[index - 1] = (unsigned char)value;
    value >>= 8;
  }
  sqlite_wire_write_bytes(wire, bytes, width);
}

void sqlite_wire_write_string(struct sqlite_wire* wire, const void* bytes, size_t length) {
  sqlite_wire_write_integer(wire, length, 4);
  sqlite_wire_write_bytes(wire, bytes, length);
}
