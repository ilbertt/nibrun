---
title: An app store for single binaries
description: Open source apps, with the binary, port and persistent storage already configured.
date: 2026-09-30
---

Self-hosting is a lot to ask of someone who just wants to use an app. Getting it online means
setting up a server, persistent storage, a reverse proxy and HTTPS. Then they need to keep that
setup working. Even if you know how to do all of it, you might not want another server to look
after just to keep some notes or share files.

That makes it harder for open source projects to reach users. Someone can want the software
and still stop at the deployment guide. The people willing to maintain a server are a smaller
group than the people who could use the app.

Many of these apps already ship a single binary. nibrun handles the hosting; what remains is
the app's port, startup arguments and data directory. We put those settings in deploy presets
so each person doesn't have to work them out again.

Now those presets have a page: [nibrun.com/apps](/apps). The button cycling through app names
under **Try it out** on the home page opens it, and there is an **Apps** link in the header.

## Choose an app

The store lists open source apps that run as a single Linux binary. You can search names and
descriptions or filter by category. Each entry links to the source repository, shows the version
it deploys, and explains the initial setup.

There is [PocketBase](/apps/pocketbase) for a backend, [Memos](/apps/memos) for notes,
[PicoShare](/apps/picoshare) for sharing files, and [Sharkord](/apps/sharkord) for text and voice
chat, among others.

Open an app's page and click **Deploy on nibrun**. The deploy form already has the binary URL,
HTTP port, arguments and environment variables. Apps that need an additional public port have
that configured too. You fill in any values specific to your instance, such as a password, and
deploy.

For Memos, there is nothing to fill in. Deploy it, open the URL, and create the first account,
which becomes the owner. Its data directory is already set to the persistent volume.

PicoShare asks for a passphrase before deployment. PocketBase prints a setup link in its logs
for creating the first superuser. Each app's page documents these steps; starting the process
doesn't create your account for you.

The **Ask your agent** button copies a prompt with links to the app's Markdown instructions and
deploy form. You can paste it into an agent that can operate the form.

## What gets deployed

These are the same [deploy links used in the PocketBase
post](/blog/deploy-pocketbase-in-one-click). A preset specifies a binary to download and the
configuration to start it with. nibrun fetches the binary, extracts it if it is in an archive,
and runs it in its own microVM.

The preset also configures the app to write its database and uploads under `data/`, so they
survive a redeploy. nibrun provides the HTTPS URL. The app handles its own users and permissions.

After deployment, you can change settings, read logs and replace the binary from the dashboard.
To upgrade an app, redeploy it with a newer binary. You choose the version and when to update.

## Exporting the app

The store deploys use the same export as an app you uploaded yourself. Download it from the
dashboard, or use the CLI:

```sh
nib apps export ./my-app.tar.gz
```

The archive contains the deployed binary, the contents of `data/`, and a `.env` with its
environment variables. To run it elsewhere, unpack it on a compatible Linux machine and start
the binary with those variables and the same arguments. Hosting, TLS and routing are then up to
you, but the database and uploaded files are already in the archive.
