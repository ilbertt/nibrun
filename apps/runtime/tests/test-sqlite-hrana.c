#include "../src/clock.h"
#include "../src/sqlite-hrana.h"
#include "expect.h"
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void execute_error(struct sqlite_hrana *stream, const char *sql,
                          int expected) {
  json_t *statement = json_pack("{s:s}", "sql", sql);
  json_t *result = NULL;
  stream->response_bytes = 0;
  EXPECT(sqlite_hrana_execute(stream, statement, &result) == expected);
  EXPECT(result == NULL);
  json_decref(statement);
}

int main(void) {
  char directory[] = "/tmp/nibrun-hrana-engine-XXXXXX";
  EXPECT(mkdtemp(directory) != NULL);
  EXPECT(chdir(directory) == 0);
  sqlite3 *writer = NULL;
  EXPECT(sqlite3_open("app.db", &writer) == SQLITE_OK);
  EXPECT(sqlite3_exec(writer,
                      "PRAGMA journal_mode=WAL; CREATE TABLE items(value); "
                      "INSERT INTO items VALUES(1)",
                      NULL, NULL, NULL) == SQLITE_OK);
  struct sqlite_hrana stream = {.query = {.connection = -1}};
  EXPECT(sqlite_query_open(&stream.query, "app.db") == SQLITE_OK);
  execute_error(&stream, "SELECT CAST(x'80' AS TEXT)", SQLITE_MISMATCH);
  execute_error(&stream, "SELECT 1e999", SQLITE_MISMATCH);
  execute_error(&stream, "SELECT 1; SELECT 2", SQLITE_MISUSE);
  execute_error(&stream, "BEGIN IMMEDIATE", SQLITE_READONLY);
  execute_error(&stream, "INSERT INTO items VALUES(2)", SQLITE_READONLY);
  execute_error(&stream, "UPDATE items SET value=2", SQLITE_READONLY);
  execute_error(&stream, "DELETE FROM items", SQLITE_READONLY);
  execute_error(&stream, "WITH selected AS (SELECT 2) INSERT INTO items SELECT * FROM selected",
                SQLITE_READONLY);
  execute_error(&stream, "SELECT FROM items", SQLITE_ERROR);
  json_t *sequence = json_pack("{s:s}", "sql", "DELETE FROM items");
  EXPECT(sqlite_hrana_sequence(&stream, sequence) == SQLITE_READONLY);
  json_decref(sequence);
  json_t *description = json_pack("{s:s}", "sql", "INSERT INTO items VALUES(2)");
  json_t *metadata = NULL;
  EXPECT(sqlite_hrana_describe(&stream, description, &metadata) == SQLITE_OK);
  EXPECT(json_is_false(json_object_get(metadata, "is_readonly")));
  json_decref(metadata);
  json_decref(description);
  execute_error(&stream,
                "WITH RECURSIVE x(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM x "
                "WHERE n<1001) SELECT n FROM x",
                SQLITE_TOOBIG);
  execute_error(
      &stream,
      "WITH RECURSIVE x(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM x WHERE "
      "n<100) SELECT replace(hex(zeroblob(30000)),'0','x') FROM x",
      SQLITE_TOOBIG);
  stream.query.deadline_ms = clock_monotonic_ms();
  execute_error(&stream,
                "WITH RECURSIVE x(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM "
                "x) SELECT sum(n) FROM x",
                SQLITE_INTERRUPT);
  stream.query.deadline_ms = clock_monotonic_ms() + SQLITE_QUERY_TIMEOUT_MS;
  json_t *invalid = json_loads("{\"requests\":[{\"type\":\"sequence\",\"sql\":"
                               "\"BEGIN\"},{\"type\":\"unknown\"}]}",
                               0, NULL);
  int status;
  json_t *reply = sqlite_hrana_pipeline(&stream, invalid, &status);
  EXPECT(status == 400);
  EXPECT(sqlite3_get_autocommit(stream.query.database));
  json_decref(reply);
  json_decref(invalid);
  EXPECT(sqlite3_exec(stream.query.database, "BEGIN; SELECT * FROM items", NULL,
                      NULL, NULL) == SQLITE_OK);
  EXPECT(sqlite3_exec(writer, "INSERT INTO items VALUES(2)", NULL, NULL,
                      NULL) == SQLITE_OK);
  sqlite_hrana_clear(&stream);
  EXPECT(sqlite3_exec(writer, "PRAGMA wal_checkpoint(TRUNCATE)", NULL, NULL,
                      NULL) == SQLITE_OK);
  EXPECT(sqlite3_close(writer) == SQLITE_OK);
  unlink("app.db");
  chdir("/");
  rmdir(directory);
  return EXPECT_REPORT("sqlite-hrana-engine");
}
