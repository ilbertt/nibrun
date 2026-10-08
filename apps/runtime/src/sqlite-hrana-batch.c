#include "sqlite-hrana.h"
#include <string.h>

static bool condition(const json_t *json, const int *states, int count,
                      bool *valid) {
  const char *type = sqlite_hrana_string(json, "type");
  if (type == NULL) {
    *valid = false;
    return false;
  }
  if (strcmp(type, "ok") == 0 || strcmp(type, "error") == 0) {
    int32_t step;
    if (!sqlite_hrana_integer(json_object_get(json, "step"), &step) ||
        step < 0 || step >= count) {
      *valid = false;
      return false;
    }
    return states[step] == (strcmp(type, "ok") == 0 ? 1 : -1);
  }
  if (strcmp(type, "not") == 0)
    return !condition(json_object_get(json, "cond"), states, count, valid);
  bool conjunction = strcmp(type, "and") == 0;
  if (!conjunction && strcmp(type, "or") != 0) {
    *valid = false;
    return false;
  }
  const json_t *items = json_object_get(json, "conds");
  if (!json_is_array(items) || json_array_size(items) > 256) {
    *valid = false;
    return false;
  }
  bool matched = conjunction;
  const json_t *item;
  for (size_t item_index = 0;
       item_index < json_array_size(items) &&
       (item = json_array_get(items, item_index)) != NULL;
       item_index++) {
    bool result = condition(item, states, count, valid);
    matched = conjunction ? matched && result : matched || result;
  }
  return matched;
}

bool sqlite_hrana_batch_valid(const json_t *json) {
  const json_t *steps =
      json_object_get(json_object_get(json, "batch"), "steps");
  if (!json_is_array(steps) || json_array_size(steps) > SQLITE_HRANA_MAX_STEPS)
    return false;
  int states[SQLITE_HRANA_MAX_STEPS] = {0};
  for (size_t index = 0; index < json_array_size(steps); index++) {
    const json_t *step = json_array_get(steps, index);
    const json_t *guard = json_object_get(step, "condition");
    bool valid = true;
    if (guard != NULL && !json_is_null(guard))
      condition(guard, states, (int)index, &valid);
    if (!valid || !sqlite_hrana_statement_valid(json_object_get(step, "stmt")))
      return false;
  }
  return true;
}

int sqlite_hrana_batch(struct sqlite_hrana *stream, const json_t *json,
                       json_t **result) {
  const json_t *steps =
      json_object_get(json_object_get(json, "batch"), "steps");
  if (!json_is_array(steps) || json_array_size(steps) > SQLITE_HRANA_MAX_STEPS)
    return SQLITE_MISUSE;
  int states[SQLITE_HRANA_MAX_STEPS] = {0};
  int index = 0;
  json_t *object = json_object();
  json_t *results = json_array();
  json_t *errors = json_array();
  json_object_set_new(object, "step_results", results);
  json_object_set_new(object, "step_errors", errors);
  if (!sqlite_hrana_reserve(stream, NULL, json_array_size(steps) * 16 + 64)) {
    json_decref(object);
    return SQLITE_TOOBIG;
  }
  const json_t *step;
  for (size_t step_index = 0;
       step_index < json_array_size(steps) &&
       (step = json_array_get(steps, step_index)) != NULL;
       step_index++) {
    const json_t *guard = json_object_get(step, "condition");
    bool valid = true;
    bool run = guard == NULL || json_is_null(guard) ||
               condition(guard, states, index, &valid);
    if (!valid) {
      json_decref(object);
      return SQLITE_MISUSE;
    }
    json_t *output = NULL;
    int code = run ? sqlite_hrana_execute(stream, json_object_get(step, "stmt"),
                                          &output)
                   : SQLITE_OK;
    states[index++] = !run ? 0 : code == SQLITE_OK ? 1 : -1;
    json_array_append_new(results, output == NULL ? json_null() : output);
    json_array_append_new(errors, code == SQLITE_OK
                                      ? json_null()
                                      : sqlite_hrana_error(stream, code));
  }
  *result = object;
  return SQLITE_OK;
}
