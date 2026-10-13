---
title: A SQLite explorer for your microVM
description: Browse tables, follow foreign keys and query your live SQLite database. Built into nibrun, with dashboard, CLI and AI agent access.
date: 2026-10-08
---

Your app's microVM now comes with a SQLite explorer. Browse tables, inspect rows, follow
foreign keys and run SQL against the live database your app is using.

It's available out of the box on nibrun. Deploy your binary, keep its SQLite database in the
persistent `data/` directory, and explore it through the dashboard or CLI. An AI agent with
access to your signed-in CLI can use the same tools.

![An app.db file inside a microVM uses a SQL over HTTP connection to the SQLite explorer, with dashboard, CLI and AI agent access highlighted.](/blog/explore-sqlite-from-the-dashboard.webp)

## Built into your deployment

nibrun provides the database connection, the web explorer and authentication. You don't need
to bundle an admin interface with your binary, install an explorer in the guest or add a SQL
endpoint to your app. SQLite support is built into new deployments.

Your app still opens its database as a file in `data/`. The explorer queries that same file
inside the microVM while your app continues using it. The database stays on your persistent
volume, and you can inspect it without exporting or downloading a copy.

The connection is read-only. You can investigate your app's data without changing it:
`INSERT`, `UPDATE`, `DELETE` and schema changes fail with SQLite's own error. Your app can
continue writing to the database normally.

## Browse tables, follow relationships and write SQL

The explorer shows your tables and their columns. Open a table to browse its rows, with
pagination for larger tables. Open a row to inspect its values and copy individual fields
or the whole row as JSON.

For supported single-column foreign keys, **View row** opens the referenced record in another
result tab, keeping the source table open. Follow an order's `user_id` to the user it belongs
to without writing a join just to look them up.

Use the SQL editor when you want to ask a question across the data. For a notebook app,
you might check which tags are used most often:

```sql
SELECT tag, COUNT(*) AS notes
FROM note_tags
GROUP BY tag
ORDER BY notes DESC;
```

The explorer header shows the app name and the database's path relative to `/app/data`, so
you can see which database you're querying. **Back to app** returns to the app overview.

## A SQL over HTTP connection to your live database

The explorer uses [SQL over HTTP](https://docs.turso.tech/sdk/http/quickstart): SQL queries go
over HTTP, and their results come back over the same connection. nibrun's API relays the
queries to SQLite inside your app's microVM.

The dashboard uses `@libsql/client` with
[libSQL's Hrana HTTP v2 protocol](https://github.com/tursodatabase/libsql/blob/main/docs/HTTP_V2_SPEC.md).
Its browsing interface embeds [LibreDB Studio](https://github.com/libredb/libredb-studio),
with styles adapted to nibrun and added foreign-key navigation.

Your existing dashboard session authenticates the connection. There is no separate database
password or token to create before opening the explorer.

## Open the database your app already uses

Open your app's **Files** tab. Files with SQLite extensions such as `.db` or `.sqlite` have
a database icon and are already links. Click the filename to open the explorer in a new tab,
or choose **Open SQLite database** from its three-dot menu.

For a database with another filename, choose **Query as SQLite** from the file menu. nibrun
checks that it can open the file as a SQLite database when the explorer first opens, then
saves the connection. That file also gets a database icon and becomes a link, so you can
come back to it later. If the file can't be opened, the explorer shows the error, and the
file list shows an error you can click to inspect.

## The same access for your CLI and AI agent

Use `nib apps sqlite` to discover the CLI commands for saved connections and SQL queries.
The CLI queries the same live database through SQL over HTTP, with the same read-only
access as the dashboard.

An AI agent with access to your signed-in `nib` CLI can use those commands to inspect the
schema and query your app's data without downloading the database or changing its contents.
Give it the
[nibrun skill](https://github.com/ilbertt/nibrun/blob/main/skills/deploy-to-nibrun/SKILL.md#inspecting-sqlite-databases)
for the CLI workflow.

> **Using a deployment from before the explorer launched?** If opening a database returns
> a 502, click **Suspend**, wait until the app shows **Suspended**, then click **Resume**.
> This briefly takes the app offline and brings it back with SQLite support. Your binary
> and persistent `data/` stay intact. Once the app is running again, retry opening the database.

[Open your apps](https://app.nibrun.com/apps) and explore the SQLite database already running
inside your microVM.
