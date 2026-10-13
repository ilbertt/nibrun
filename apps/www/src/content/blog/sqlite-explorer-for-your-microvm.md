---
title: A SQLite explorer for your microVM
description: Browse and query SQLite databases in your microVM. Built into nibrun, with dashboard and CLI access.
date: 2026-10-08
---

nibrun now includes a SQLite explorer for your app's microVM. Browse tables, inspect rows
and run SQL against the database in `data/`, without downloading a copy.

It works out of the box with new deployments. nibrun supplies the explorer and database
connection; your binary keeps using SQLite as usual.

![SQLite in a microVM connects to the explorer through SQL over HTTP, with dashboard, CLI and AI agent access.](/blog/explore-sqlite-from-the-dashboard.webp)

The connection uses [SQL over HTTP](https://docs.turso.tech/sdk/http/quickstart) to query the
file inside your microVM. Queries are read-only, and your dashboard session authenticates
them. Your app can keep writing to the database.

## Open a database

Open your app's **Files** tab and click a `.db` or `.sqlite` file. For other filenames,
choose **Query as SQLite** from the three-dot menu. The explorer opens in a new tab,
and the connection is saved for next time.

The interface uses [LibreDB Studio](https://github.com/libredb/libredb-studio). It supports
paginated table browsing, a SQL editor and copying rows as JSON. For supported single-column
foreign keys, **View row** opens the referenced record in another result tab.

## CLI and AI agents

Use `nib apps sqlite` to find the commands for connections and SQL queries. An AI agent
with access to your signed-in CLI can query the same live database. Give it the
[nibrun skill](https://github.com/ilbertt/nibrun/blob/main/skills/deploy-to-nibrun/SKILL.md#inspecting-sqlite-databases)
for the workflow.

> **Older deployment returning a 502?** Suspend the app, wait for **Suspended**, then resume
> it to pick up SQLite support. This briefly takes the app offline; its binary and `data/`
> stay intact.

[Open your apps](https://app.nibrun.com/apps) and pick a database.
