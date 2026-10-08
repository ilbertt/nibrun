#include "../src/sqlite-database.h"
#include "expect.h"
#include <stdlib.h>
#include <unistd.h>

int main(void) {
  char directory[] = "/tmp/nibrun-sqlite-database-XXXXXX";
  EXPECT(mkdtemp(directory) != NULL);
  EXPECT(chdir(directory) == 0);
  sqlite3 *writer = NULL;
  EXPECT(sqlite3_open("app.db", &writer) == SQLITE_OK);
  EXPECT(sqlite3_exec(writer,
                      "PRAGMA journal_mode=WAL; CREATE TABLE items(value); "
                      "INSERT INTO items VALUES(1)",
                      NULL, NULL, NULL) == SQLITE_OK);
  struct sqlite_query query = {.connection = -1};
  EXPECT(sqlite_query_open(&query, "app.db") == SQLITE_OK);
  EXPECT(sqlite3_exec(query.database, "SELECT * FROM items", NULL, NULL,
                      NULL) == SQLITE_OK);
  EXPECT(sqlite3_exec(query.database, "INSERT INTO items VALUES(2)", NULL, NULL,
                      NULL) == SQLITE_READONLY);
  EXPECT(sqlite3_db_readonly(query.database, "main") == 1);
  EXPECT(sqlite3_exec(query.database, "UPDATE items SET value=2", NULL, NULL,
                      NULL) == SQLITE_READONLY);
  EXPECT(sqlite3_exec(query.database, "DELETE FROM items", NULL, NULL,
                      NULL) == SQLITE_READONLY);
  EXPECT(sqlite3_exec(query.database, "CREATE TABLE forbidden(value)", NULL, NULL,
                      NULL) == SQLITE_READONLY);
  EXPECT(sqlite3_exec(query.database, "CREATE TEMP TABLE forbidden(value)", NULL, NULL,
                      NULL) == SQLITE_READONLY);
  EXPECT(sqlite3_exec(query.database, "DROP TABLE items", NULL, NULL,
                      NULL) == SQLITE_READONLY);
  EXPECT(sqlite3_exec(query.database, "PRAGMA query_only=OFF", NULL, NULL,
                      NULL) == SQLITE_AUTH);
  EXPECT(sqlite3_exec(query.database, "ATTACH 'other.db' AS other", NULL, NULL,
                      NULL) == SQLITE_AUTH);
  EXPECT(sqlite3_exec(query.database, "PRAGMA writable_schema=ON", NULL, NULL,
                      NULL) == SQLITE_AUTH);
  EXPECT(sqlite3_exec(query.database, "PRAGMA table_info(items)", NULL, NULL,
                      NULL) == SQLITE_OK);
  EXPECT(sqlite3_close(query.database) == SQLITE_OK);
  EXPECT(sqlite3_close(writer) == SQLITE_OK);
  struct sqlite_query invalid = {.connection = -1};
  EXPECT(sqlite_query_open(&invalid, "../app.db") == SQLITE_CANTOPEN);
  EXPECT(sqlite_query_open(&invalid, "missing.db") == SQLITE_CANTOPEN);
  EXPECT(access("missing.db", F_OK) != 0);
  EXPECT(symlink("app.db", "link.db") == 0);
  EXPECT(sqlite_query_open(&invalid, "link.db") == SQLITE_CANTOPEN);
  unlink("link.db");
  EXPECT(symlink("app.db", "app.db-wal") == 0);
  EXPECT(sqlite_query_open(&invalid, "app.db") == SQLITE_CANTOPEN);
  unlink("app.db-wal");
  EXPECT(symlink(".", "directory") == 0);
  EXPECT(sqlite_query_open(&invalid, "directory/app.db") == SQLITE_CANTOPEN);
  unlink("directory");
  unlink("app.db");
  chdir("/");
  rmdir(directory);
  return EXPECT_REPORT("sqlite-database");
}
