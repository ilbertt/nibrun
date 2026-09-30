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

They're now collected in an [app store](/apps): [PocketBase](/apps/pocketbase) for a backend,
[Memos](/apps/memos) for notes,
[PicoShare](/apps/picoshare) for sharing files, and [Sharkord](/apps/sharkord) for text and voice
chat. Each app's page includes its source repository, release version and setup instructions.

## Deploying an app

Each deploy link supplies the binary URL, HTTP port, arguments and environment variables,
including any additional public port the app needs. You provide values specific to your
instance, such as a password, and deploy.

Memos needs no additional configuration. Once deployed, open its URL and create the first
account, which becomes the owner.

nibrun runs the binary in its own microVM and provides the HTTPS URL. The presets configure
databases and uploads to live under `data/`, which survives redeploys. The app handles its own
users and permissions.

To upgrade an app, redeploy it with a newer binary.

## Exporting the app

Export the app from the dashboard or CLI:

```sh
nib apps export ./my-app.tar.gz
```

The archive contains the deployed binary, the contents of `data/`, and a `.env` with its
environment variables. To run it elsewhere, unpack it on a compatible Linux machine and start
the binary with those variables and the same arguments. You will need to provide hosting and
HTTPS on that machine.
