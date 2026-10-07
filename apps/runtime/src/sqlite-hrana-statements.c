#include "clock.h"
#include "sqlite-hrana.h"
#include "sqlite-values.h"
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct json_budget {
  size_t bytes;
};

static int count_json(const char *bytes, size_t length, void *context) {
  (void)bytes;
  struct json_budget *budget = context;
  if (length > SQLITE_RESPONSE_MAX_BYTES - budget->bytes)
    return -1;
  budget->bytes += length;
  return 0;
}

bool sqlite_hrana_reserve(struct sqlite_hrana *stream, const json_t *json,
                          size_t overhead) {
  if (overhead > SQLITE_RESPONSE_MAX_BYTES - stream->response_bytes)
    return false;
  struct json_budget budget = {.bytes = stream->response_bytes + overhead};
  if (json != NULL && json_dump_callback(json, count_json, &budget,
                                         JSON_COMPACT | JSON_ENCODE_ANY) != 0)
    return false;
  stream->response_bytes = budget.bytes;
  return true;
}

static const char *error_name(int code) {
  switch (code & 255) {
  case SQLITE_AUTH:
    return "SQLITE_AUTH";
  case SQLITE_READONLY:
    return "SQLITE_READONLY";
  case SQLITE_CANTOPEN:
    return "SQLITE_CANTOPEN";
  case SQLITE_NOTADB:
    return "SQLITE_NOTADB";
  case SQLITE_INTERRUPT:
    return "SQLITE_INTERRUPT";
  case SQLITE_TOOBIG:
    return "SQLITE_TOOBIG";
  case SQLITE_RANGE:
    return "SQLITE_RANGE";
  case SQLITE_MISMATCH:
    return "SQLITE_MISMATCH";
  case SQLITE_NOMEM:
    return "SQLITE_NOMEM";
  case SQLITE_BUSY:
    return "SQLITE_BUSY";
  case SQLITE_MISUSE:
    return "PROTO_ERROR";
  default:
    return "SQLITE_ERROR";
  }
}

json_t *sqlite_hrana_error(struct sqlite_hrana *stream, int code) {
  json_t *error = json_object();
  const char *message =
      stream->query.database != NULL &&
              sqlite3_errcode(stream->query.database) == (code & 255)
          ? sqlite3_errmsg(stream->query.database)
          : sqlite3_errstr(code);
  json_object_set_new(error, "code", json_string(error_name(code)));
  size_t length = strlen(message);
  if (length > 1024)
    length = 1024;
  json_t *description = json_stringn(message, length);
  while (description == NULL && length > 0)
    description = json_stringn(message, --length);
  json_object_set_new(error, "message", description);
  if (!sqlite_hrana_reserve(stream, error, 16)) {
    json_decref(error);
    return json_pack("{s:s,s:s}", "code", "SQLITE_TOOBIG", "message",
                     "Response exceeds query limits");
  }
  return error;
}

const char *sqlite_hrana_string(const json_t *json, const char *name) {
  const json_t *field = json_object_get(json, name);
  return json_is_string(field) &&
                 json_string_length(field) == strlen(json_string_value(field))
             ? json_string_value(field)
             : NULL;
}

bool sqlite_hrana_integer(const json_t *field, int32_t *number) {
  if (!json_is_integer(field) || json_integer_value(field) < INT32_MIN ||
      json_integer_value(field) > INT32_MAX)
    return false;
  *number = (int32_t)json_integer_value(field);
  return true;
}

static const char *sql_text(struct sqlite_hrana *stream, const json_t *json) {
  const json_t *sql = json_object_get(json, "sql");
  const json_t *id = json_object_get(json, "sql_id");
  bool has_text = sql != NULL && !json_is_null(sql);
  bool has_id = id != NULL && !json_is_null(id);
  if (has_text == has_id)
    return NULL;
  if (has_text)
    return json_is_string(sql) &&
                   json_string_length(sql) == strlen(json_string_value(sql)) &&
                   json_string_length(sql) <= SQLITE_REQUEST_MAX_BYTES
               ? json_string_value(sql)
               : NULL;
  int32_t number;
  if (!sqlite_hrana_integer(id, &number))
    return NULL;
  for (size_t index = 0; index < SQLITE_HRANA_STORED_SQL; index++)
    if (stream->sql[index].text != NULL && stream->sql[index].id == number)
      return stream->sql[index].text;
  return NULL;
}

static int prepare(struct sqlite_hrana *stream, const char *sql,
                   sqlite3_stmt **statement) {
  if (sql == NULL)
    return SQLITE_MISUSE;
  const char *tail;
  int code =
      sqlite3_prepare_v3(stream->query.database, sql, -1, 0, statement, &tail);
  if (code != SQLITE_OK || *statement == NULL)
    return code == SQLITE_OK ? SQLITE_MISUSE : code;
  if (!sqlite3_stmt_readonly(*statement))
    return SQLITE_READONLY;
  sqlite3_stmt *extra = NULL;
  code = sqlite3_prepare_v3(stream->query.database, tail, -1, 0, &extra, NULL);
  bool single = extra == NULL;
  sqlite3_finalize(extra);
  return code != SQLITE_OK ? code : single ? SQLITE_OK : SQLITE_MISUSE;
}

static json_t *columns(sqlite3_stmt *statement) {
  json_t *result = json_array();
  for (int index = 0; index < sqlite3_column_count(statement); index++) {
    json_t *column = json_object();
    const char *name = sqlite3_column_name(statement, index);
    const char *type = sqlite3_column_decltype(statement, index);
    json_object_set_new(column, "name", json_string(name == NULL ? "" : name));
    json_object_set_new(column, "decltype",
                        type == NULL ? json_null() : json_string(type));
    if (json_object_get(column, "name") == NULL ||
        json_object_get(column, "decltype") == NULL) {
      json_decref(column);
      json_decref(result);
      return NULL;
    }
    json_array_append_new(result, column);
  }
  return result;
}

static int named_index(sqlite3_stmt *statement, const char *name) {
  size_t length = strlen(name);
  if (length == 0 || length > 256)
    return 0;
  if (strchr(":@$?", name[0]) != NULL)
    return sqlite3_bind_parameter_index(statement, name);
  char identifier[258];
  memcpy(identifier + 1, name, length + 1);
  const char prefixes[] = {':', '@', '$'};
  for (size_t index = 0; index < sizeof(prefixes); index++) {
    identifier[0] = prefixes[index];
    int found = sqlite3_bind_parameter_index(statement, identifier);
    if (found != 0)
      return found;
  }
  return 0;
}

bool sqlite_hrana_reference_valid(const json_t *json) {
  const json_t *sql = json_object_get(json, "sql");
  const json_t *id = json_object_get(json, "sql_id");
  bool has_sql = sql != NULL && !json_is_null(sql);
  bool has_id = id != NULL && !json_is_null(id);
  int32_t number;
  return has_sql != has_id &&
         (has_sql ? sqlite_hrana_string(json, "sql") != NULL &&
                        json_string_length(sql) <= SQLITE_REQUEST_MAX_BYTES
                  : sqlite_hrana_integer(id, &number));
}

bool sqlite_hrana_statement_valid(const json_t *json) {
  if (!json_is_object(json) || !sqlite_hrana_reference_valid(json))
    return false;
  const json_t *args = json_object_get(json, "args");
  const json_t *named = json_object_get(json, "named_args");
  const json_t *want = json_object_get(json, "want_rows");
  if ((args != NULL && !json_is_array(args)) ||
      (named != NULL && !json_is_array(named)) ||
      json_array_size(args) + json_array_size(named) > 256 ||
      (want != NULL && !json_is_boolean(want)))
    return false;
  for (size_t index = 0; index < json_array_size(args); index++)
    if (!sqlite_value_valid(json_array_get(args, index)))
      return false;
  for (size_t index = 0; index < json_array_size(named); index++) {
    const json_t *argument = json_array_get(named, index);
    const char *name = sqlite_hrana_string(argument, "name");
    if (name == NULL || strlen(name) > 256 ||
        !sqlite_value_valid(json_object_get(argument, "value")))
      return false;
  }
  return true;
}

static int bind_parameters(sqlite3_stmt *statement, const json_t *json) {
  const json_t *args = json_object_get(json, "args");
  const json_t *named = json_object_get(json, "named_args");
  if ((args != NULL && !json_is_array(args)) ||
      (named != NULL && !json_is_array(named)) ||
      json_array_size(args) + json_array_size(named) > 256)
    return SQLITE_MISUSE;
  bool bound[257] = {false};
  int index = 0;
  const json_t *value;
  for (size_t value_index = 0;
       value_index < json_array_size(args) &&
       (value = json_array_get(args, value_index)) != NULL;
       value_index++) {
    index++;
    bound[index] = true;
    int code = sqlite_bind_value(statement, index, value);
    if (code != SQLITE_OK)
      return code;
  }
  for (size_t value_index = 0;
       value_index < json_array_size(named) &&
       (value = json_array_get(named, value_index)) != NULL;
       value_index++) {
    const char *name = sqlite_hrana_string(value, "name");
    index = name == NULL ? 0 : named_index(statement, name);
    if (index < 1 || index > 256 || bound[index])
      return SQLITE_RANGE;
    bound[index] = true;
    int code =
        sqlite_bind_value(statement, index, json_object_get(value, "value"));
    if (code != SQLITE_OK)
      return code;
  }
  for (index = 1; index <= sqlite3_bind_parameter_count(statement); index++)
    if (!bound[index])
      return SQLITE_RANGE;
  return SQLITE_OK;
}

int sqlite_hrana_execute(struct sqlite_hrana *stream, const json_t *json,
                         json_t **result) {
  sqlite3_stmt *statement = NULL;
  int code = prepare(stream, sql_text(stream, json), &statement);
  if (code == SQLITE_OK)
    code = bind_parameters(statement, json);
  const json_t *want = json_object_get(json, "want_rows");
  if (want != NULL && !json_is_boolean(want))
    code = SQLITE_MISUSE;
  if (code != SQLITE_OK) {
    sqlite3_finalize(statement);
    return code;
  }
  json_t *object = json_object();
  json_t *rows = json_array();
  json_t *metadata = columns(statement);
  if (metadata == NULL) {
    json_decref(object);
    json_decref(rows);
    sqlite3_finalize(statement);
    return SQLITE_MISMATCH;
  }
  json_object_set_new(object, "cols", metadata);
  json_object_set_new(object, "rows", rows);
  int count = 0;
  if (!sqlite_hrana_reserve(stream, object, 128)) {
    json_decref(object);
    sqlite3_finalize(statement);
    return SQLITE_TOOBIG;
  }
  while ((code = sqlite3_step(statement)) == SQLITE_ROW) {
    if (json_is_false(want))
      continue;
    if (count++ >= 1000 || !sqlite_hrana_reserve(stream, NULL, 3)) {
      code = SQLITE_TOOBIG;
      break;
    }
    json_t *row = json_array();
    for (int column = 0; column < sqlite3_column_count(statement); column++) {
      json_t *value = sqlite_column_json(statement, column);
      if (value == NULL) {
        code = (sqlite3_column_type(statement, column) == SQLITE_TEXT ||
                sqlite3_column_type(statement, column) == SQLITE_FLOAT)
                   ? SQLITE_MISMATCH
                   : SQLITE_NOMEM;
        break;
      }
      if (!sqlite_hrana_reserve(stream, value, 1)) {
        json_decref(value);
        code = SQLITE_TOOBIG;
        break;
      }
      json_array_append_new(row, value);
    }
    json_array_append_new(rows, row);
    if (code != SQLITE_ROW)
      break;
  }
  sqlite3_finalize(statement);
  if (code != SQLITE_DONE) {
    json_decref(object);
    return code;
  }
  json_object_set_new(object, "affected_row_count", json_integer(0));
  json_object_set_new(
      object, "last_insert_rowid",
      sqlite_integer_json(sqlite3_last_insert_rowid(stream->query.database)));
  *result = object;
  return SQLITE_OK;
}

int sqlite_hrana_describe(struct sqlite_hrana *stream, const json_t *json,
                          json_t **result) {
  sqlite3_stmt *statement = NULL;
  int code = prepare(stream, sql_text(stream, json), &statement);
  if (code == SQLITE_OK) {
    json_t *object = json_object();
    json_t *params = json_array();
    for (int index = 1; index <= sqlite3_bind_parameter_count(statement);
         index++) {
      json_t *param = json_object();
      const char *name = sqlite3_bind_parameter_name(statement, index);
      json_object_set_new(param, "name",
                          name == NULL ? json_null() : json_string(name));
      if (json_object_get(param, "name") == NULL) {
        json_decref(param);
        json_decref(params);
        json_decref(object);
        sqlite3_finalize(statement);
        return SQLITE_MISMATCH;
      }
      json_array_append_new(params, param);
    }
    json_object_set_new(object, "params", params);
    json_object_set_new(object, "cols", columns(statement));
    json_object_set_new(object, "is_readonly", json_boolean(true));
    json_object_set_new(object, "is_explain",
                        json_boolean(sqlite3_stmt_isexplain(statement) != 0));
    if (json_object_get(object, "cols") == NULL) {
      json_decref(object);
      code = SQLITE_MISMATCH;
    } else if (!sqlite_hrana_reserve(stream, object, 32)) {
      json_decref(object);
      code = SQLITE_TOOBIG;
    } else
      *result = object;
  }
  sqlite3_finalize(statement);
  return code;
}

int sqlite_hrana_sequence(struct sqlite_hrana *stream, const json_t *json) {
  const char *position = sql_text(stream, json);
  if (position == NULL)
    return SQLITE_MISUSE;
  while (*position != 0) {
    sqlite3_stmt *statement = NULL;
    const char *tail;
    int code = sqlite3_prepare_v3(stream->query.database, position, -1, 0,
                                  &statement, &tail);
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
