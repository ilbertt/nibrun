---
title: Deploy PocketBase in one click
description: The database, the auth, the admin UI — one file. Then you try to host it.
date: 2026-08-26
---

[PocketBase](https://pocketbase.io) ships as a single compiled binary. Download it, run it, and
you have a database, an auth system, file storage, realtime subscriptions and an admin UI. One
process, one directory on disk, no dependencies to install.

Anyone who has self-hosted [Supabase](https://supabase.com) knows that same feature list as half
a dozen services and a compose file holding them together. PocketBase is roughly that surface
area, in one file.

Then you go to deploy it, and the easy and quick deployment promise of a single binary stops mattering.

## The current world

There are two ways to get it online, and both spend the simplicity you just bought.

Put it on a platform like [Railway](https://railway.com) and the first redeploy eats your
database. A container's filesystem is thrown away and rebuilt on every deploy, so the app comes
back up looking fine with nothing in it. The fix is a volume: another resource to provision,
mount, point `--dir` at, and pay for — all so the app can keep a directory.

Take a VM at [DigitalOcean](https://www.digitalocean.com) instead and the app is the easy part.
What you actually signed up for is the TLS certificate and its renewal, the reverse proxy in
front of it, the OS updates, the firewall, and the backups — not for an evening, but for as long
as the thing is up.

Either way the work is assembling a machine. PocketBase never asked for one to be taken apart.
It asked for a directory it could write to and a port it could listen on.

## Fulfilling the promise

That is all nibrun hands it.

Grab the Linux build from the [PocketBase releases
page](https://github.com/pocketbase/pocketbase/releases) (`pocketbase_<version>_linux_amd64.zip`)
and unzip it. Inside is one file called `pocketbase`. That is the whole application.

Drag and drop it onto [nibrun.com](https://nibrun.com).

You land on the deploy screen with the binary already attached. Two fields to fill in:

**Guest port**: `8090`

**Arguments** (one per line):

```
serve
--http=0.0.0.0:8090
--dir=./data/pb_data
```

Deploy.

A few seconds later PocketBase is answering on `https://<your-app>.nibrun.app`, and the
admin UI is at `/_/`. There is no certificate to obtain and no OS underneath it that is yours to
patch.

There is a CLI too, if your mouse click doesn't work anymore:

```sh
curl -fsSL https://nibrun.com/install.sh | sh
nib login
```

`nib run` is then the same deploy in one line. Same binary, same arguments, same port:

```sh
nib run "./pocketbase serve --http=0.0.0.0:8090 --dir=./data/pb_data" \
  --name pocketbase --port 8090
```

## Creating the first superuser

On its first start PocketBase prints a one-time installer link to its log. It is under the app's
Logs tab in the dashboard, or from the terminal:

```sh
nib apps logs --app pocketbase
```

The link will look like `http://0.0.0.0:8090/_/#/pbinstal/<token>`, because PocketBase only knows
the address it was told to bind. Swap the host for your own and keep the rest:

```
https://<your-app>.nibrun.app/_/#/pbinstal/<token>
```

That opens the admin UI and lets you create the first superuser.

## What the alternatives want first

Railway and a bare VM are two points on one list. Here is the rest of it, ordered by nothing
except how much has to exist before your binary gets to run.

| | What you build first | Where the data lives |
| --- | --- | --- |
| **nibrun** | Nothing — the binary is the artifact | `data/`, on the same machine |
| **Fly.io** | A Dockerfile, a `fly.toml`, a volume you created and mounted | A Fly volume |
| **Render** | A Dockerfile, a service definition, a disk on a paid instance | A Render disk |
| **Railway** | A Dockerfile or a buildpack it guesses at, plus a volume | A Railway volume |
| **A VPS** | A user, a systemd unit, a reverse proxy, a TLS certificate, a firewall, a backup job | Wherever you put it |
| **PocketHost** | Nothing, but you are on their PocketBase | Theirs |

PocketHost is the honest exception: it is managed PocketBase, and if what you want is PocketBase
with none of the operating, it is a good answer. The tradeoff is that the instance is theirs. You
are on their version, their machine, and their upgrade schedule.

## Tired of nibrun? Zip and go

One command — or one click in the dashboard — and the whole app comes back as a `.tar.gz`:

```sh
nib apps export ./my-export.tar.gz
```

Inside: the binary that was running, the entire `data/` directory as it stood on disk, and a
`.env` of the variables it was deployed with. Unpack it anywhere (Linux! or download the proper pocketbase binary)
and `./pocketbase serve --dir=./data/pb_data` is serving the same app again. Same records, same
uploaded files, same superuser accounts, off the same command line as further up this page.

There is no managed database to migrate off, because there was never a managed database. Leaving
costs you a download.
