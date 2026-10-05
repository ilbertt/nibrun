#include "sqlite-query.h"
#include <string.h>
#include "clock.h"

static void metadata(sqlite3_stmt* statement, struct sqlite_wire* reply) {
  int count = sqlite3_column_count(statement);
  sqlite_wire_write_integer(reply, (uint32_t)count, 4);
  for (int index = 0; index < count; index++) {
    const char* name = sqlite3_column_name(statement, index);
    const char* type = sqlite3_column_decltype(statement, index);
    sqlite_wire_write_string(reply, name, strlen(name));
    sqlite_wire_write_string(reply, type, type == NULL ? 0 : strlen(type));
  }
}

static void column(sqlite3_stmt* statement, int index, struct sqlite_wire* reply) {
  int type = sqlite3_column_type(statement, index);
  switch (type) {
    case SQLITE_INTEGER:
      sqlite_wire_write_integer(reply, SQLITE_WIRE_INTEGER, 1);
      sqlite_wire_write_integer(reply, (uint64_t)sqlite3_column_int64(statement, index), 8);
      break;
    case SQLITE_FLOAT: {
      double number = sqlite3_column_double(statement, index);
      uint64_t bits;
      memcpy(&bits, &number, sizeof(bits));
      sqlite_wire_write_integer(reply, SQLITE_WIRE_FLOAT, 1);
      sqlite_wire_write_integer(reply, bits, 8);
      break;
    }
    case SQLITE_TEXT:
    case SQLITE_BLOB: {
      const void* bytes = type == SQLITE_TEXT ? (const void*)sqlite3_column_text(statement, index)
                                              : sqlite3_column_blob(statement, index);
      sqlite_wire_write_integer(reply, type == SQLITE_TEXT ? SQLITE_WIRE_TEXT : SQLITE_WIRE_BLOB,
                                1);
      sqlite_wire_write_string(reply, bytes, (size_t)sqlite3_column_bytes(statement, index));
      break;
    }
    default:
      sqlite_wire_write_integer(reply, SQLITE_WIRE_NULL, 1);
  }
}

static int bind_value(sqlite3_stmt* statement, int index, struct sqlite_wire* request) {
  unsigned char type = (unsigned char)sqlite_wire_integer(request, 1);
  switch (type) {
    case SQLITE_WIRE_NULL:
      return sqlite3_bind_null(statement, index);
    case SQLITE_WIRE_INTEGER:
      return sqlite3_bind_int64(statement, index, (sqlite3_int64)sqlite_wire_integer(request, 8));
    case SQLITE_WIRE_FLOAT: {
      uint64_t bits = sqlite_wire_integer(request, 8);
      double number;
      memcpy(&number, &bits, sizeof(number));
      return sqlite3_bind_double(statement, index, number);
    }
    case SQLITE_WIRE_TEXT:
    case SQLITE_WIRE_BLOB: {
      size_t length;
      const unsigned char* bytes = sqlite_wire_string(request, &length);
      if (request->failed)
        return SQLITE_MISUSE;
      return type == SQLITE_WIRE_TEXT
                 ? sqlite3_bind_text(statement, index, (const char*)bytes, (int)length,
                                     SQLITE_TRANSIENT)
                 : sqlite3_bind_blob(statement, index, bytes, (int)length, SQLITE_TRANSIENT);
    }
    default:
      return SQLITE_MISUSE;
  }
}

static int named_parameter(sqlite3_stmt* statement, const unsigned char* name, size_t length) {
  char identifier[257] = {0};
  if (name[0] == ':' || name[0] == '@' || name[0] == '$' || name[0] == '?') {
    memcpy(identifier, name, length);
    return sqlite3_bind_parameter_index(statement, identifier);
  }
  memcpy(identifier + 1, name, length);
  const char prefixes[] = {':', '@', '$'};
  for (size_t index = 0; index < sizeof(prefixes); index++) {
    identifier[0] = prefixes[index];
    int parameter = sqlite3_bind_parameter_index(statement, identifier);
    if (parameter != 0)
      return parameter;
  }
  return 0;
}

static int bind_parameters(sqlite3_stmt* statement, struct sqlite_wire* request) {
  uint32_t count = (uint32_t)sqlite_wire_integer(request, 4);
  if (count > 256)
    return SQLITE_RANGE;
  bool bound[257] = {false};
  int positional = 0;
  for (uint32_t parameter = 0; parameter < count; parameter++) {
    size_t length;
    const unsigned char* name = sqlite_wire_string(request, &length);
    if (request->failed || length > 255 || (length > 0 && memchr(name, 0, length)))
      return SQLITE_MISUSE;
    int index;
    if (length == 0)
      index = ++positional;
    else {
      index = named_parameter(statement, name, length);
    }
    if (index < 1 || index > sqlite3_bind_parameter_count(statement) || bound[index])
      return SQLITE_RANGE;
    bound[index] = true;
    int code = bind_value(statement, index, request);
    if (code != SQLITE_OK || request->failed)
      return code == SQLITE_OK ? SQLITE_MISUSE : code;
  }
  for (int index = 1; index <= sqlite3_bind_parameter_count(statement); index++)
    if (!bound[index])
      return SQLITE_RANGE;
  return request->position == request->length && !request->failed ? SQLITE_OK : SQLITE_MISUSE;
}

static int prepare(struct sqlite_query* query, const char* sql, int length,
                   sqlite3_stmt** statement) {
  const char* tail;
  int code = sqlite3_prepare_v3(query->database, sql, length, 0, statement, &tail);
  if (code != SQLITE_OK || *statement == NULL)
    return code == SQLITE_OK ? SQLITE_MISUSE : code;
  if (!sqlite3_stmt_readonly(*statement))
    return SQLITE_READONLY;
  sqlite3_stmt* extra = NULL;
  code = sqlite3_prepare_v3(query->database, tail, -1, 0, &extra, NULL);
  bool single = extra == NULL;
  sqlite3_finalize(extra);
  return code != SQLITE_OK ? code : single ? SQLITE_OK : SQLITE_MISUSE;
}

static int execute(struct sqlite_query* query, struct sqlite_wire* request,
                   struct sqlite_wire* reply) {
  size_t length;
  const unsigned char* bytes = sqlite_wire_string(request, &length);
  if (request->failed || length == 0 || memchr(bytes, 0, length))
    return SQLITE_MISUSE;
  char sql[SQLITE_WIRE_MAX_BYTES + 1];
  memcpy(sql, bytes, length);
  sql[length] = '\0';
  bool rows = sqlite_wire_integer(request, 1) != 0;
  sqlite3_stmt* statement = NULL;
  int code = prepare(query, sql, (int)length, &statement);
  if (code == SQLITE_OK)
    code = bind_parameters(statement, request);
  if (code != SQLITE_OK) {
    sqlite3_finalize(statement);
    return code;
  }
  metadata(statement, reply);
  size_t count_position = reply->position;
  sqlite_wire_write_integer(reply, 0, 4);
  uint32_t row_count = 0;
  while ((code = sqlite3_step(statement)) == SQLITE_ROW && !reply->failed) {
    if (!rows)
      continue;
    if (row_count == 1000) {
      code = SQLITE_TOOBIG;
      break;
    }
    row_count++;
    for (int index = 0; index < sqlite3_column_count(statement); index++)
      column(statement, index, reply);
  }
  if (code == SQLITE_DONE && !reply->failed) {
    struct sqlite_wire count = {.bytes = reply->bytes + count_position, .length = 4};
    sqlite_wire_write_integer(&count, row_count, 4);
    sqlite_wire_write_integer(reply, 0, 8);
    sqlite_wire_write_integer(reply, (uint64_t)sqlite3_last_insert_rowid(query->database), 8);
    sqlite_wire_write_integer(reply, sqlite3_get_autocommit(query->database), 1);
    code = SQLITE_OK;
  }
  sqlite3_finalize(statement);
  return reply->failed ? SQLITE_TOOBIG : code;
}

static int describe(struct sqlite_query* query, struct sqlite_wire* request,
                    struct sqlite_wire* reply) {
  if (memchr(request->bytes, 0, request->length))
    return SQLITE_MISUSE;
  sqlite3_stmt* statement = NULL;
  int code = prepare(query, (const char*)request->bytes, (int)request->length, &statement);
  if (code == SQLITE_OK) {
    int count = sqlite3_bind_parameter_count(statement);
    sqlite_wire_write_integer(reply, (uint32_t)count, 4);
    for (int index = 1; index <= count; index++) {
      const char* name = sqlite3_bind_parameter_name(statement, index);
      sqlite_wire_write_string(reply, name, name == NULL ? 0 : strlen(name));
    }
    metadata(statement, reply);
    sqlite_wire_write_integer(reply, sqlite3_stmt_readonly(statement), 1);
    sqlite_wire_write_integer(reply, sqlite3_stmt_isexplain(statement) != 0, 1);
  }
  sqlite3_finalize(statement);
  return reply->failed ? SQLITE_TOOBIG : code;
}

static int sequence(struct sqlite_query* query, struct sqlite_wire* request) {
  if (request->length > SQLITE_WIRE_MAX_BYTES || memchr(request->bytes, 0, request->length))
    return SQLITE_MISUSE;
  char sql[SQLITE_WIRE_MAX_BYTES + 1];
  memcpy(sql, request->bytes, request->length);
  sql[request->length] = '\0';
  const char* position = sql;
  while (*position != '\0') {
    sqlite3_stmt* statement = NULL;
    const char* tail;
    int code = sqlite3_prepare_v3(query->database, position, -1, 0, &statement, &tail);
    if (code == SQLITE_OK && statement != NULL) {
      if (!sqlite3_stmt_readonly(statement))
        code = SQLITE_READONLY;
      else {
        while ((code = sqlite3_step(statement)) == SQLITE_ROW) {
        }
        if (code == SQLITE_DONE)
          code = SQLITE_OK;
      }
    }
    sqlite3_finalize(statement);
    if (code != SQLITE_OK)
      return code;
    position = tail;
  }
  return SQLITE_OK;
}

unsigned char sqlite_query_run(struct sqlite_query* query, unsigned char operation,
                               struct sqlite_wire* request, struct sqlite_wire* reply) {
  query->deadline_ms = clock_monotonic_ms() + SQLITE_QUERY_TIMEOUT_MS;
  int code;
  unsigned char result;
  switch (operation) {
    case SQLITE_WIRE_EXECUTE:
      code = execute(query, request, reply);
      result = SQLITE_WIRE_RESULT;
      break;
    case SQLITE_WIRE_DESCRIBE:
      code = describe(query, request, reply);
      result = SQLITE_WIRE_DESCRIPTION;
      break;
    case SQLITE_WIRE_SEQUENCE:
      code = sequence(query, request);
      result = SQLITE_WIRE_OK;
      break;
    default:
      code = SQLITE_MISUSE;
      result = SQLITE_WIRE_ERROR;
  }
  if (code != SQLITE_OK) {
    sqlite_query_error(query, code, reply);
    return SQLITE_WIRE_ERROR;
  }
  return result;
}
