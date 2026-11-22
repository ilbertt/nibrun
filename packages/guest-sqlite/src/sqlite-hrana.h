#ifndef NIBRUN_SQLITE_HRANA_H
#define NIBRUN_SQLITE_HRANA_H
#include "sqlite-database.h"
#include <jansson.h>
#define SQLITE_HTTP_MAX_BYTES (4 * 1024 * 1024)
#define SQLITE_JSON_MAX_NODES 16384
#define SQLITE_JSON_MAX_DEPTH 32
#define SQLITE_HRANA_MAX_STEPS 256
#define SQLITE_HRANA_MAX_REQUESTS 64
#define SQLITE_HRANA_STORED_SQL 30
struct sqlite_stored_sql {
  int32_t id;
  char *text;
};
struct sqlite_hrana {
  struct sqlite_query query;
  struct sqlite_stored_sql sql[SQLITE_HRANA_STORED_SQL];
  char baton[64];
  uint64_t generation;
  bool closed;
  size_t response_bytes;
};
bool sqlite_hrana_reserve(struct sqlite_hrana *stream, const json_t *json,
                          size_t overhead);
json_t *sqlite_hrana_error(struct sqlite_hrana *stream, int code);
json_t *sqlite_hrana_pipeline(struct sqlite_hrana *stream, const json_t *body,
                              int *status);
const char *sqlite_hrana_string(const json_t *json, const char *name);
bool sqlite_hrana_integer(const json_t *field, int32_t *number);
int sqlite_hrana_execute(struct sqlite_hrana *stream, const json_t *json,
                         json_t **result);
int sqlite_hrana_describe(struct sqlite_hrana *stream, const json_t *json,
                          json_t **result);
int sqlite_hrana_sequence(struct sqlite_hrana *stream, const json_t *json);
bool sqlite_hrana_reference_valid(const json_t *json);
bool sqlite_hrana_statement_valid(const json_t *json);
bool sqlite_hrana_batch_valid(const json_t *json);
int sqlite_hrana_batch(struct sqlite_hrana *stream, const json_t *json,
                       json_t **result);
void sqlite_hrana_clear(struct sqlite_hrana *stream);
#endif
