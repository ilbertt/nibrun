---
title: Explore SQLite from the dashboard
description: Open your app's SQLite files, browse their tables and run SQL without downloading the database.
date: 2026-10-08
---

SQLite puts your database in a file. When your app runs on nibrun, that file lives in its
persistent `data/` directory. Your app can use it directly, but looking inside it used to mean
exporting the data and opening a local copy.

You can now explore it from the dashboard. Pick the file, mark it as a SQLite database, and
open it in a new tab. The queries run against the database your app is using.

## From a file to a database

Open your app's **Files** tab. Find the database, open its three-dot menu, and choose
**Mark as SQLite database**.

![The file explorer in dark mode, with the app.db menu open and the Mark as SQLite database option visible.](/blog/mark-as-sqlite-database.jpg "Open a file's menu to connect it to the SQLite explorer.")

The filename doesn't need a `.sqlite` or `.db` extension. The option is available for any
regular file, and nibrun checks that it can open it as a SQLite database before saving the
connection. If it can't, the file shows an error you can click to inspect.

Once connected, the file gets a database icon and becomes a link. Click it to open the
explorer in a separate browser tab. The connection is saved, so you can come back through the
same file later.

## Browse tables or write SQL

The explorer shows your tables and their columns. Open a table to browse its rows, with
pagination for larger tables. Open a row to inspect its values and copy individual fields
or the whole row as JSON.

For supported single-column foreign keys, **View row** opens the referenced record in another
result tab, keeping the source table open. Follow an order's `user_id` to the user it belongs
to without writing a join just to look them up.

The SQL editor is there when a table view isn't enough. For a notebook app, you might check
which tags are used most often:

```sql
SELECT tag, COUNT(*) AS notes
FROM note_tags
GROUP BY tag
ORDER BY notes DESC;
```

The explorer header shows the app name and the database's path relative to `/app/data`.
**Back to app** returns to the app overview.

## Built on LibreDB Studio and libSQL

The explorer embeds [LibreDB Studio](https://github.com/libredb/libredb-studio) for table browsing,
row details and the SQL editor. We adapt its styles to the dashboard and add foreign-key navigation.

Queries use [libSQL's Hrana HTTP v2 protocol](https://github.com/tursodatabase/libsql/blob/main/docs/HTTP_V2_SPEC.md)
through `@libsql/client` in the browser. nibrun's API relays them to a read-only SQLite connection
inside your app's microVM.

## Your app's file, opened read-only

Explorer connections are read-only. You can inspect data while your app keeps using the
database, but `INSERT`, `UPDATE`, `DELETE` and schema changes fail with SQLite's own error.

Your existing dashboard session authenticates the connection. There is no separate database
password or token to create before opening the explorer.

The database stays in your app's persistent directory. Your binary still opens the same file,
and you can still export it with the rest of your app's data.

[Open your apps](https://app.nibrun.com/apps), pick a database file, and take a look inside.
