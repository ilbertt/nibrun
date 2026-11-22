#include "sqlite-values.h"
#include <errno.h>
#include <inttypes.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char alphabet[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static char *base64_encode(const unsigned char *bytes, size_t length) {
  size_t size = ((length + 2) / 3) * 4;
  char *text = malloc(size + 1);
  if (text == NULL)
    return NULL;
  size_t position = 0;
  for (size_t index = 0; index < length; index += 3) {
    uint32_t value = (uint32_t)bytes[index] << 16;
    if (index + 1 < length)
      value |= (uint32_t)bytes[index + 1] << 8;
    if (index + 2 < length)
      value |= bytes[index + 2];
    text[position++] = alphabet[(value >> 18) & 63];
    text[position++] = alphabet[(value >> 12) & 63];
    text[position++] = index + 1 < length ? alphabet[(value >> 6) & 63] : '=';
    text[position++] = index + 2 < length ? alphabet[value & 63] : '=';
  }
  text[position] = 0;
  return text;
}

static int base64_digit(unsigned char byte) {
  const char *found = byte == 0 ? NULL : strchr(alphabet, byte);
  return found == NULL ? -1 : (int)(found - alphabet);
}

static int bind_blob(sqlite3_stmt *statement, int index, const char *text) {
  size_t length = strlen(text);
  if (length % 4 != 0 || length > 87384)
    return SQLITE_MISMATCH;
  unsigned char *bytes = malloc(length / 4 * 3 + 1);
  if (bytes == NULL)
    return SQLITE_NOMEM;
  size_t position = 0;
  int code = SQLITE_OK;
  for (size_t offset = 0; offset < length; offset += 4) {
    int a = base64_digit(text[offset]);
    int b = base64_digit(text[offset + 1]);
    int c = text[offset + 2] == '=' ? 0 : base64_digit(text[offset + 2]);
    int d = text[offset + 3] == '=' ? 0 : base64_digit(text[offset + 3]);
    bool padded = text[offset + 2] == '=' || text[offset + 3] == '=';
    if (a < 0 || b < 0 || c < 0 || d < 0 || (padded && offset + 4 != length) ||
        (text[offset + 2] == '=' && (text[offset + 3] != '=' || (b & 15))) ||
        (text[offset + 3] == '=' && text[offset + 2] != '=' && (c & 3))) {
      code = SQLITE_MISMATCH;
      break;
    }
    uint32_t value = (uint32_t)((a << 18) | (b << 12) | (c << 6) | d);
    bytes[position++] = (unsigned char)(value >> 16);
    if (text[offset + 2] != '=')
      bytes[position++] = (unsigned char)(value >> 8);
    if (text[offset + 3] != '=')
      bytes[position++] = (unsigned char)value;
  }
  if (code == SQLITE_OK)
    code = sqlite3_bind_blob(statement, index, bytes, (int)position,
                             SQLITE_TRANSIENT);
  free(bytes);
  return code;
}

bool sqlite_value_valid(const json_t *value) {
  const json_t *type = json_object_get(value, "type");
  const json_t *data = json_object_get(value, "value");
  if (!json_is_string(type) ||
      json_string_length(type) != strlen(json_string_value(type)))
    return false;
  const char *name = json_string_value(type);
  if (strcmp(name, "null") == 0)
    return true;
  if (strcmp(name, "float") == 0)
    return json_is_number(data) && isfinite(json_number_value(data));
  if (strcmp(name, "text") == 0)
    return json_is_string(data) && json_string_length(data) <= 65536;
  if (strcmp(name, "integer") == 0) {
    if (!json_is_string(data) || json_string_length(data) == 0 ||
        json_string_length(data) > 20 ||
        json_string_length(data) != strlen(json_string_value(data)))
      return false;
    const char *number = json_string_value(data);
    if (*number == '-')
      number++;
    if (*number == 0 || (*number == '0' && number[1] != 0))
      return false;
    for (; *number; number++)
      if (*number < '0' || *number > '9')
        return false;
    return true;
  }
  if (strcmp(name, "blob") != 0)
    return false;
  data = json_object_get(value, "base64");
  if (!json_is_string(data) || json_string_length(data) > 87384 ||
      json_string_length(data) % 4 != 0)
    return false;
  const char *text = json_string_value(data);
  for (size_t index = 0; index < json_string_length(data); index++)
    if (base64_digit((unsigned char)text[index]) < 0 &&
        !(text[index] == '=' && index + 2 >= json_string_length(data)))
      return false;
  return true;
}

int sqlite_bind_value(sqlite3_stmt *statement, int index, const json_t *value) {
  const json_t *type = json_object_get(value, "type");
  const json_t *data = json_object_get(value, "value");
  if (!json_is_string(type) ||
      json_string_length(type) != strlen(json_string_value(type)))
    return SQLITE_MISMATCH;
  if (strcmp(json_string_value(type), "null") == 0)
    return sqlite3_bind_null(statement, index);
  if (strcmp(json_string_value(type), "integer") == 0 && json_is_string(data)) {
    const char *text = json_string_value(data);
    if (json_string_length(data) != strlen(text))
      return SQLITE_MISMATCH;
    char *end;
    errno = 0;
    if (*text == 0 || *text == '+' || *text == ' ' ||
        (*text == '-' && text[1] == 0))
      return SQLITE_MISMATCH;
    for (const char *digit = *text == '-' ? text + 1 : text; *digit; digit++)
      if (*digit < '0' || *digit > '9')
        return SQLITE_MISMATCH;
    int64_t number = strtoll(text, &end, 10);
    return errno != 0 || *end != 0
               ? SQLITE_MISMATCH
               : sqlite3_bind_int64(statement, index, number);
  }
  if (strcmp(json_string_value(type), "float") == 0 && json_is_number(data) &&
      isfinite(json_number_value(data)))
    return sqlite3_bind_double(statement, index, json_number_value(data));
  if (strcmp(json_string_value(type), "text") == 0 && json_is_string(data)) {
    if (json_string_length(data) > 65536)
      return SQLITE_TOOBIG;
    return sqlite3_bind_text(statement, index, json_string_value(data),
                             (int)json_string_length(data), SQLITE_TRANSIENT);
  }
  data = json_object_get(value, "base64");
  if (strcmp(json_string_value(type), "blob") == 0 && json_is_string(data) &&
      json_string_length(data) == strlen(json_string_value(data)))
    return bind_blob(statement, index, json_string_value(data));
  return SQLITE_MISMATCH;
}

json_t *sqlite_integer_json(sqlite3_int64 number) {
  char decimal[32];
  snprintf(decimal, sizeof(decimal), "%" PRId64, (int64_t)number);
  return json_string(decimal);
}

json_t *sqlite_column_json(sqlite3_stmt *statement, int index) {
  json_t *result = json_object();
  int type = sqlite3_column_type(statement, index);
  switch (type) {
  case SQLITE_INTEGER:
    json_object_set_new(result, "type", json_string("integer"));
    json_object_set_new(
        result, "value",
        sqlite_integer_json(sqlite3_column_int64(statement, index)));
    break;
  case SQLITE_FLOAT:
    json_object_set_new(result, "type", json_string("float"));
    json_object_set_new(result, "value",
                        json_real(sqlite3_column_double(statement, index)));
    break;
  case SQLITE_TEXT:
    json_object_set_new(result, "type", json_string("text"));
    json_object_set_new(
        result, "value",
        json_stringn((const char *)sqlite3_column_text(statement, index),
                     (size_t)sqlite3_column_bytes(statement, index)));
    break;
  case SQLITE_BLOB: {
    char *text = base64_encode(sqlite3_column_blob(statement, index),
                               (size_t)sqlite3_column_bytes(statement, index));
    if (text == NULL) {
      json_decref(result);
      return NULL;
    }
    json_object_set_new(result, "type", json_string("blob"));
    json_object_set_new(result, "base64", json_string(text));
    free(text);
    break;
  }
  default:
    json_object_set_new(result, "type", json_string("null"));
  }
  if (type != SQLITE_NULL &&
      json_object_get(result, type == SQLITE_BLOB ? "base64" : "value") ==
          NULL) {
    json_decref(result);
    return NULL;
  }
  return result;
}
