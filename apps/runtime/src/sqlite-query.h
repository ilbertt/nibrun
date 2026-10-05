#ifndef NIBRUN_SQLITE_QUERY_H
#define NIBRUN_SQLITE_QUERY_H
#include "sqlite-database.h"
unsigned char sqlite_query_run(struct sqlite_query *query, unsigned char operation,
                              struct sqlite_wire *request, struct sqlite_wire *reply);
#endif
