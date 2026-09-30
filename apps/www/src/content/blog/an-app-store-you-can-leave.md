---
title: An app store you can leave
description: Pick an open source app, deploy its binary, and take it with you when you want out.
date: 2026-09-30
---

You want somewhere to keep notes. Or a link you can send someone so they can download a file.
Or a place for five friends to talk. There is already an open source app that does it.

Finding the app is the easy part. Getting your own copy online is where the afternoon goes.
Read the hosting guide, find the right release, work out which port it listens on and where it
writes its database. Then arrange a machine, a volume, a reverse proxy and a certificate around
it. All before you have written a note.

We have added an [app store](/apps) to nibrun. The button cycling through app names under
**Try it out** on the home page now opens the whole catalog. Pick something, click deploy, use it.

## The part between finding it and using it

The store is a catalog of apps that ship a single Linux binary. Search by name or what the app
does, or filter by category. Each app has its own page with a description, the source repository,
the version you are about to deploy, and the steps for getting into it once it is running.

A few places to start:

- [Memos](/apps/memos) for short notes, tags and search.
- [PicoShare](/apps/picoshare) for uploading a file and handing someone a download link.
- [PocketBase](/apps/pocketbase) for a database, auth, file storage and an admin UI.
- [Sharkord](/apps/sharkord) for text and voice channels with your own group.

The **Deploy on nibrun** button opens the deploy screen with the binary, arguments, ports and
data directory already configured. If the app needs a password, that is what the form asks you
for. You don't have to learn which environment variable the password belongs in.

Take Memos. Open its page, click deploy, then open the URL and create the first account. That
account becomes the owner. Write a note. The database is already on the volume that survives a
redeploy, and the URL already has HTTPS.

PicoShare asks you to choose a passphrase first. PocketBase has a first-superuser link in its
logs. Those details are on each app's page, because "one click" gets the process running; the app
still has its own front door.

There is an **Ask your agent** button too. It copies a prompt with the app's instructions and
deploy link, so you can hand the same job to an agent without explaining the setup yourself.

## A deploy link, with somewhere to browse

The store uses the same [deploy links we wrote about for
PocketBase](/blog/deploy-pocketbase-in-one-click). Each entry supplies the executable to fetch and
the settings to run it with. The catalog gives those links a place to live, and you a way to
choose between them.

Once deployed, it is an ordinary nibrun app: one binary in its own microVM, with its files in
`data/`. You can read the logs, change the settings, or redeploy a newer binary from the dashboard.
Choosing when to upgrade and looking after the accounts inside the app are still your jobs.

The machine is ours. The notes, files and conversations on it are yours. That distinction ought
to survive the day you decide to stop paying us.

## Zip and go

Export from the dashboard, or use the CLI:

```sh
nib apps export ./my-app.tar.gz
```

The archive contains the binary, everything in `data/`, and a `.env` with the variables it was
running with. Take those to another Linux machine, run the binary with the same settings, and
the app has its data back. You still have to arrange hosting there. You don't have to rebuild
your notes or persuade a service to release your files.

It is the same bet as the rest of nibrun: [small apps that fit on one
machine](/blog/small-apps-dont-need-to-scale), with less work between wanting one and using it.

[**Browse the apps**](/apps)
