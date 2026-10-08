#ifndef NIBRUN_SQLITE_VALUES_H
#define NIBRUN_SQLITE_VALUES_H
#include <jansson.h>
#include <sqlite3.h>
#include <stdbool.h>
bool sqlite_value_valid(const json_t *value);
int sqlite_bind_value(sqlite3_stmt *statement, int index, const json_t *value);
json_t *sqlite_column_json(sqlite3_stmt *statement, int index);
json_t *sqlite_integer_json(sqlite3_int64 number);
#endif
