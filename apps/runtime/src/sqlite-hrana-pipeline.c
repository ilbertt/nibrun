#include "clock.h"
#include "sqlite-hrana.h"
#include <errno.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/random.h>

static int store_sql(struct sqlite_hrana *stream, const json_t *json,
                     bool closing) {
  int32_t id;
  if (!sqlite_hrana_integer(json_object_get(json, "sql_id"), &id))
    return SQLITE_MISUSE;
  size_t empty = SQLITE_HRANA_STORED_SQL;
  for (size_t index = 0; index < SQLITE_HRANA_STORED_SQL; index++) {
    if (stream->sql[index].text == NULL) {
      empty = index;
      continue;
    }
    if (stream->sql[index].id != id)
      continue;
    if (!closing)
      return SQLITE_MISUSE;
    free(stream->sql[index].text);
    stream->sql[index].text = NULL;
    return SQLITE_OK;
  }
  if (closing)
    return SQLITE_OK;
  const char *text = sqlite_hrana_string(json, "sql");
  if (empty == SQLITE_HRANA_STORED_SQL || text == NULL ||
      strlen(text) > SQLITE_REQUEST_MAX_BYTES)
    return SQLITE_TOOBIG;
  stream->sql[empty].id = id;
  stream->sql[empty].text = strdup(text);
  return stream->sql[empty].text == NULL ? SQLITE_NOMEM : SQLITE_OK;
}

void sqlite_hrana_clear(struct sqlite_hrana *stream) {
  for (size_t index = 0; index < SQLITE_HRANA_STORED_SQL; index++) {
    free(stream->sql[index].text);
    stream->sql[index].text = NULL;
  }
  if (stream->query.database != NULL) {
    sqlite3_close(stream->query.database);
    stream->query.database = NULL;
  }
  stream->closed = true;
}

static json_t *stream_request(struct sqlite_hrana *stream,
                              const json_t *request) {
  const char *type = sqlite_hrana_string(request, "type");
  json_t *result = NULL;
  int code = SQLITE_MISUSE;
  if (!sqlite_hrana_reserve(stream, NULL, 128))
    return json_pack("{s:s,s:o}", "type", "error", "error",
                     sqlite_hrana_error(stream, SQLITE_TOOBIG));
  if (type != NULL && !stream->closed) {
    if (strcmp(type, "execute") == 0)
      code = sqlite_hrana_execute(stream, json_object_get(request, "stmt"),
                                  &result);
    else if (strcmp(type, "describe") == 0)
      code = sqlite_hrana_describe(stream, request, &result);
    else if (strcmp(type, "sequence") == 0)
      code = sqlite_hrana_sequence(stream, request);
    else if (strcmp(type, "batch") == 0)
      code = sqlite_hrana_batch(stream, request, &result);
    else if (strcmp(type, "store_sql") == 0)
      code = store_sql(stream, request, false);
    else if (strcmp(type, "close_sql") == 0)
      code = store_sql(stream, request, true);
    else if (strcmp(type, "close") == 0) {
      sqlite_hrana_clear(stream);
      code = SQLITE_OK;
    }
  }
  json_t *output = json_object();
  json_object_set_new(output, "type",
                      json_string(code == SQLITE_OK ? "ok" : "error"));
  if (code != SQLITE_OK) {
    json_decref(result);
    json_object_set_new(output, "error", sqlite_hrana_error(stream, code));
  } else {
    json_t *response = json_object();
    json_object_set_new(response, "type", json_string(type));
    if (result != NULL)
      json_object_set_new(response, "result", result);
    json_object_set_new(output, "response", response);
  }
  return output;
}

static bool request_valid(const json_t *request) {
  const char *type = sqlite_hrana_string(request, "type");
  if (type == NULL)
    return false;
  if (strcmp(type, "execute") == 0)
    return sqlite_hrana_statement_valid(json_object_get(request, "stmt"));
  if (strcmp(type, "batch") == 0)
    return sqlite_hrana_batch_valid(request);
  if (strcmp(type, "describe") == 0 || strcmp(type, "sequence") == 0)
    return sqlite_hrana_reference_valid(request);
  if (strcmp(type, "close") == 0)
    return true;
  int32_t id;
  if (!sqlite_hrana_integer(json_object_get(request, "sql_id"), &id))
    return false;
  if (strcmp(type, "close_sql") == 0)
    return true;
  if (strcmp(type, "store_sql") != 0)
    return false;
  const char *sql = sqlite_hrana_string(request, "sql");
  return sql != NULL && strlen(sql) <= SQLITE_REQUEST_MAX_BYTES;
}

static bool requests_valid(const json_t *requests) {
  if (!json_is_array(requests) ||
      json_array_size(requests) > SQLITE_HRANA_MAX_REQUESTS)
    return false;
  for (size_t index = 0; index < json_array_size(requests); index++)
    if (!request_valid(json_array_get(requests, index)))
      return false;
  return true;
}

static bool rotate_baton(struct sqlite_hrana *stream) {
  unsigned char bytes[16];
  size_t position = 0;
  while (position < sizeof(bytes)) {
    ssize_t count = getrandom(bytes + position, sizeof(bytes) - position, 0);
    if (count < 0 && errno == EINTR)
      continue;
    if (count <= 0)
      return false;
    position += (size_t)count;
  }
  for (size_t index = 0; index < sizeof(bytes); index++)
    snprintf(stream->baton + index * 2, 3, "%02x", bytes[index]);
  return true;
}

json_t *sqlite_hrana_pipeline(struct sqlite_hrana *stream, const json_t *body,
                              int *status) {
  const json_t *baton = json_object_get(body, "baton");
  const json_t *requests = json_object_get(body, "requests");
  bool matches = stream->generation == 0
                     ? baton == NULL || json_is_null(baton)
                     : json_is_string(baton) &&
                           json_string_length(baton) == strlen(stream->baton) &&
                           strcmp(json_string_value(baton), stream->baton) == 0;
  if (!matches || !requests_valid(requests) || stream->closed) {
    *status = 400;
    return sqlite_hrana_error(stream, SQLITE_MISUSE);
  }
  if (!rotate_baton(stream)) {
    *status = 500;
    return sqlite_hrana_error(stream, SQLITE_IOERR);
  }
  stream->response_bytes = 128;
  json_t *output = json_object();
  json_t *results = json_array();
  stream->query.deadline_ms = clock_monotonic_ms() + SQLITE_QUERY_TIMEOUT_MS;
  const json_t *request;
  for (size_t request_index = 0;
       request_index < json_array_size(requests) &&
       (request = json_array_get(requests, request_index)) != NULL;
       request_index++)
    json_array_append_new(results, stream_request(stream, request));
  stream->generation++;
  json_object_set_new(output, "baton",
                      stream->closed ? json_null()
                                     : json_string(stream->baton));
  json_object_set_new(output, "base_url", json_null());
  json_object_set_new(output, "results", results);
  *status = 200;
  return output;
}
