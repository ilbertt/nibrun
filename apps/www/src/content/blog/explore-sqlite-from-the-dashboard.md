---
title: Explore SQLite from the dashboard
description: Open your app's SQLite files, browse their tables and run SQL without downloading the database.
date: 2026-10-08
---

SQLite puts your database in a file. When your app runs on nibrun, that file lives in its
persistent `data/` directory. Your app can use it directly, but looking inside it used to mean
exporting the data and opening a local copy.

You can now explore it from the dashboard. Open the database file in a new tab, and the
queries run against the database your app is using.

![A SQLite database file opens in the nibrun dashboard to browse tables and run read-only SQL.](/blog/explore-sqlite-from-the-dashboard.webp)

> **Already running an app?** If it was running before the SQLite explorer launched, you
> may get a 502 when opening a database. Click **Suspend**, wait until the app shows
> **Suspended**, then click **Resume**. This briefly takes the app offline and brings it
> back with SQLite support. Your binary and persistent `data/` stay intact. Once the app
> is running again, retry opening the database.

## From a file to a database

Open your app's **Files** tab. Files with SQLite extensions such as `.db` or `.sqlite` have
a database icon and are already links. Click the filename to open the explorer in a new tab,
or open its three-dot menu and choose **Open SQLite database**.

The filename doesn't need a `.sqlite` or `.db` extension. For other regular files, choose
**Query as SQLite** from the three-dot menu. nibrun checks that it can open the file as a
SQLite database when the explorer first opens, then saves the connection. If it can't, the
explorer shows the error, and the file list shows an error you can click to inspect.

Once connected, a file without a recognized SQLite extension also gets a database icon and
becomes a link. The connection is saved, so you can come back through the same file later.

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

## Explore with your AI agent

An AI agent with access to your signed-in `nib` CLI can query the live database too.
Connections are read-only, so it can explore without changing data or schema. Give it the
[nibrun skill](https://github.com/ilbertt/nibrun/blob/main/skills/deploy-to-nibrun/SKILL.md#inspecting-sqlite-databases)
for the CLI workflow.

[Open your apps](https://app.nibrun.com/apps), pick a database file, and take a look inside.
