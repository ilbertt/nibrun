#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "expect.h"
#include "../src/sqlite-query.h"

static unsigned char response[SQLITE_WIRE_MAX_BYTES];
static size_t response_length;

static unsigned char run(struct sqlite_query* query, unsigned char operation, const char* sql) {
  unsigned char bytes[SQLITE_WIRE_MAX_BYTES + 1];
  struct sqlite_wire writer = {.bytes = bytes, .length = SQLITE_WIRE_MAX_BYTES};
  if (operation == SQLITE_WIRE_EXECUTE) {
    sqlite_wire_write_string(&writer, sql, strlen(sql));
    sqlite_wire_write_integer(&writer, 1, 1);
    sqlite_wire_write_integer(&writer, 0, 4);
  } else
    sqlite_wire_write_bytes(&writer, sql, strlen(sql));
  bytes[writer.position] = 0;
  struct sqlite_wire request = {.bytes = bytes, .length = writer.position};
  struct sqlite_wire reply = {.bytes = response, .length = sizeof(response)};
  unsigned char code = sqlite_query_run(query, operation, &request, &reply);
  response_length = reply.position;
  return code;
}

static int error_code(void) {
  struct sqlite_wire reply = {.bytes = response, .length = response_length};
  return (int)sqlite_wire_integer(&reply, 4) & 255;
}

static void typed_results(struct sqlite_query* query) {
  EXPECT(run(query, SQLITE_WIRE_EXECUTE,
             "SELECT 9223372036854775807 AS number, x'00ff' AS bytes, NULL AS empty, 1.5 AS "
             "fraction") == SQLITE_WIRE_RESULT);
  struct sqlite_wire reply = {.bytes = response, .length = response_length};
  EXPECT(sqlite_wire_integer(&reply, 4) == 4);
  size_t length;
  for (int index = 0; index < 4; index++) {
    sqlite_wire_string(&reply, &length);
    sqlite_wire_string(&reply, &length);
  }
  EXPECT(sqlite_wire_integer(&reply, 4) == 1);
  EXPECT(sqlite_wire_integer(&reply, 1) == SQLITE_WIRE_INTEGER);
  EXPECT(sqlite_wire_integer(&reply, 8) == INT64_MAX);
  EXPECT(sqlite_wire_integer(&reply, 1) == SQLITE_WIRE_BLOB);
  const unsigned char* blob = sqlite_wire_string(&reply, &length);
  EXPECT(length == 2 && blob[0] == 0 && blob[1] == 255);
  EXPECT(sqlite_wire_integer(&reply, 1) == SQLITE_WIRE_NULL);
  EXPECT(sqlite_wire_integer(&reply, 1) == SQLITE_WIRE_FLOAT);
  uint64_t bits = sqlite_wire_integer(&reply, 8);
  double number;
  memcpy(&number, &bits, sizeof(number));
  EXPECT(number == 1.5);
}

static void bounded_queries(struct sqlite_query* query) {
  EXPECT(run(query, SQLITE_WIRE_EXECUTE,
             "WITH RECURSIVE rows(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM rows WHERE x<1001) "
             "SELECT NULL FROM rows") == SQLITE_WIRE_ERROR);
  EXPECT(error_code() == SQLITE_TOOBIG);
  EXPECT(run(query, SQLITE_WIRE_EXECUTE,
             "WITH RECURSIVE rows(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM rows WHERE x<100000) "
             "SELECT x FROM rows") == SQLITE_WIRE_ERROR);
  EXPECT(error_code() == SQLITE_TOOBIG);
  EXPECT(run(query, SQLITE_WIRE_EXECUTE,
             "WITH RECURSIVE forever(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM forever) SELECT "
             "sum(x) FROM forever") == SQLITE_WIRE_ERROR);
  EXPECT(error_code() == SQLITE_INTERRUPT);
  EXPECT(run(query, SQLITE_WIRE_EXECUTE, "SELECT 1") == SQLITE_WIRE_RESULT);
}

static void parameters(struct sqlite_query* query) {
  unsigned char bytes[256];
  struct sqlite_wire writer = {.bytes = bytes, .length = sizeof(bytes)};
  const char* sql = "SELECT :value, @second";
  sqlite_wire_write_string(&writer, sql, strlen(sql));
  sqlite_wire_write_integer(&writer, 1, 1);
  sqlite_wire_write_integer(&writer, 2, 4);
  sqlite_wire_write_string(&writer, "value", 5);
  sqlite_wire_write_integer(&writer, SQLITE_WIRE_INTEGER, 1);
  sqlite_wire_write_integer(&writer, (uint64_t)INT64_MIN, 8);
  sqlite_wire_write_string(&writer, "second", 6);
  sqlite_wire_write_integer(&writer, SQLITE_WIRE_TEXT, 1);
  sqlite_wire_write_string(&writer, "a\0b", 3);
  struct sqlite_wire request = {.bytes = bytes, .length = writer.position};
  struct sqlite_wire reply = {.bytes = response, .length = sizeof(response)};
  EXPECT(sqlite_query_run(query, SQLITE_WIRE_EXECUTE, &request, &reply) == SQLITE_WIRE_RESULT);
  EXPECT(run(query, SQLITE_WIRE_EXECUTE, "SELECT ?") == SQLITE_WIRE_ERROR);
  EXPECT(error_code() == SQLITE_RANGE);
}

int main(void) {
  char directory[] = "/tmp/nibrun-sqlite-XXXXXX";
  EXPECT(mkdtemp(directory) != NULL);
  EXPECT(chdir(directory) == 0);
  sqlite3* writer = NULL;
  EXPECT(sqlite3_open("app.db", &writer) == SQLITE_OK);
  EXPECT(
      sqlite3_exec(
          writer,
          "PRAGMA journal_mode=WAL; CREATE TABLE items(value INTEGER); INSERT INTO items VALUES(1)",
          NULL, NULL, NULL) == SQLITE_OK);
  struct sqlite_query query = {.connection = -1};
  EXPECT(sqlite_query_open(&query, "app.db") == SQLITE_OK);
  typed_results(&query);
  parameters(&query);
  EXPECT(run(&query, SQLITE_WIRE_DESCRIBE, "SELECT :name AS value FROM items") ==
         SQLITE_WIRE_DESCRIPTION);
  EXPECT(run(&query, SQLITE_WIRE_EXECUTE, "PRAGMA table_info(items)") == SQLITE_WIRE_RESULT);
  EXPECT(run(&query, SQLITE_WIRE_EXECUTE, "INSERT INTO items VALUES(2)") == SQLITE_WIRE_ERROR);
  EXPECT(error_code() == SQLITE_AUTH);
  EXPECT(run(&query, SQLITE_WIRE_SEQUENCE, "ATTACH 'other.db' AS other") == SQLITE_WIRE_ERROR);
  EXPECT(error_code() == SQLITE_AUTH);
  EXPECT(run(&query, SQLITE_WIRE_SEQUENCE, "PRAGMA writable_schema=ON") == SQLITE_WIRE_ERROR);
  EXPECT(run(&query, SQLITE_WIRE_EXECUTE, "SELECT 1; SELECT 2") == SQLITE_WIRE_ERROR);
  EXPECT(run(&query, SQLITE_WIRE_SEQUENCE, "BEGIN") == SQLITE_WIRE_OK);
  EXPECT(!sqlite3_get_autocommit(query.database));
  EXPECT(run(&query, SQLITE_WIRE_SEQUENCE, "ROLLBACK") == SQLITE_WIRE_OK);
  EXPECT(sqlite3_exec(writer, "INSERT INTO items VALUES(2)", NULL, NULL, NULL) == SQLITE_OK);
  EXPECT(run(&query, SQLITE_WIRE_EXECUTE, "SELECT count(*) FROM items") == SQLITE_WIRE_RESULT);
  struct sqlite_wire count = {.bytes = response, .length = response_length};
  sqlite_wire_integer(&count, 4);
  size_t length;
  sqlite_wire_string(&count, &length);
  sqlite_wire_string(&count, &length);
  EXPECT(sqlite_wire_integer(&count, 4) == 1);
  EXPECT(sqlite_wire_integer(&count, 1) == SQLITE_WIRE_INTEGER);
  EXPECT(sqlite_wire_integer(&count, 8) == 2);
  EXPECT(run(&query, SQLITE_WIRE_SEQUENCE, "BEGIN IMMEDIATE") == SQLITE_WIRE_ERROR);
  EXPECT(error_code() == SQLITE_READONLY);
  EXPECT(run(&query, SQLITE_WIRE_EXECUTE, "BEGIN EXCLUSIVE") == SQLITE_WIRE_ERROR);
  EXPECT(error_code() == SQLITE_READONLY);
  bounded_queries(&query);
  EXPECT(sqlite3_close(query.database) == SQLITE_OK);
  EXPECT(sqlite3_close(writer) == SQLITE_OK);
  struct sqlite_query invalid = {.connection = -1};
  EXPECT(sqlite_query_open(&invalid, "../app.db") == SQLITE_CANTOPEN);
  EXPECT(sqlite_query_open(&invalid, "missing.db") == SQLITE_CANTOPEN);
  EXPECT(access("missing.db", F_OK) != 0);
  EXPECT(symlink("app.db", "link.db") == 0);
  EXPECT(sqlite_query_open(&invalid, "link.db") == SQLITE_CANTOPEN);
  int file = open("text.db", O_CREAT | O_WRONLY, 0600);
  EXPECT(write(file, "not a SQLite database", 21) == 21);
  close(file);
  EXPECT(sqlite_query_open(&invalid, "text.db") == SQLITE_NOTADB);
  unlink("app.db");
  unlink("link.db");
  unlink("text.db");
  chdir("/");
  rmdir(directory);
  return EXPECT_REPORT("sqlite-query");
}
