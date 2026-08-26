---
title: Deploy PocketBase in one click
description: PocketBase is one file. Most ways to host it want a Dockerfile, a YAML file and a volume you provisioned first.
date: 2026-08-26
---

[PocketBase](https://pocketbase.io) ships as a single compiled binary. Download it, run it, and
you have a database, an auth system, file storage, realtime subscriptions and an admin UI — one
process, one directory on disk, no dependencies to install.

Anyone who has self-hosted [Supabase](https://supabase.com) knows that same list as a stack:
Postgres, GoTrue, PostgREST, Realtime, Storage, Kong, Studio, and a compose file holding them
together. PocketBase is roughly the same surface area, folded into one file.

Then you go to deploy it, and the file stops mattering.

## The detour

Here is the shortest honest path from that binary to a URL, on the platforms people actually
reach for.

You write a Dockerfile. It is three lines — a base image, a `COPY`, a `CMD` — and it exists
entirely so that a platform which only knows how to run images will agree to run your file. Now
you own it. It rebuilds on every PocketBase release, and a build step sits between you and every
deploy from here on.

[Railway](https://railway.com) builds it and it boots. You create a collection, add a record,
push a fix, and the record is gone — a container filesystem is not a disk. So you provision a
volume, mount it, point `--dir` at the mount, and deploy again. Now it survives.

The volume pins the service to a single machine, which the platform mentions in the tone of a
limitation. It is not one. PocketBase was only ever going to be one machine.

Or you skip the image entirely and take a VM at [DigitalOcean](https://www.digitalocean.com),
where the work is not a Dockerfile but a user, a systemd unit, a reverse proxy, a certificate
that has to renew, a firewall, and a backup job you promise yourself you will write next weekend.

Either way, the evening went to putting a machine back together. That is what every step on both
lists is. A container is a machine with the disk pulled out and the name taken away, so the
platform sells the disk back to you as a volume and the name back as a service. A VM is a machine
with nothing on it yet, so you fit the parts by hand. PocketBase asked for neither. It asked for
a directory it could write to and a port it could listen on.

## The one click

That is all nibrun hands it.

Grab the Linux build from the [PocketBase releases
page](https://github.com/pocketbase/pocketbase/releases) — `pocketbase_<version>_linux_amd64.zip`
— and unzip it. Inside is one file called `pocketbase`. That is the whole application.

Drag it onto [nibrun.com](https://nibrun.com).

You land on the deploy screen with the binary already attached. Two fields to fill in:

**Guest port** — `8090`

**Arguments**, one per line:

```
serve
--http=0.0.0.0:8090
--dir=./data/pb_data
```

Deploy. A few seconds later PocketBase is answering on `https://<your-app>.nibrun.app`, and the
admin UI is at `/_/`.

If you would rather stay in a terminal, it is the same thing in one command:

```sh
nib run "./pocketbase serve --http=0.0.0.0:8090 --dir=./data/pb_data" \
  --name pocketbase --port 8090
```

## Why those three arguments

None of them are nibrun-specific ceremony. They are the three defaults PocketBase picks for
running on your laptop, and all three are wrong on any server.

`serve` is PocketBase's own subcommand — the binary is a multi-command tool, and running it bare
prints help and exits.

`--http=0.0.0.0:8090` is the important one. PocketBase binds `127.0.0.1` by default, which on a
machine of its own means nothing outside can reach it. nibrun hands your process a port in `PORT`
and routes to it, and here you are telling PocketBase to take that port on every interface. The
port number is written out rather than passed as `$PORT` because there is no shell involved —
arguments go straight to `exec`, so `8090` has to match the Guest port field. Pick any number
you like, as long as it is the same in both places.

`--dir=./data/pb_data` is where your database ends up. PocketBase defaults to `pb_data` next to
the binary, and on nibrun the only directory that survives a restart is `data/`. Point it inside
and your data outlives every redeploy; leave it at the default and you lose the whole database the
first time the app restarts. This is the one that bites people, and it bites them a week later.

## Creating the first superuser

On its first start PocketBase prints a one-time installer link to its log. Read it back with:

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

## What it costs

nibrun is free while it is in beta.

Everywhere else, the shape of the bill is the same: a small always-on instance, plus a persistent
volume, billed separately. Free tiers usually exclude the disk, or sleep the instance, and an
app with a SQLite file is exactly the kind of app that does not enjoy being slept. Check the
current numbers yourself — they move — but budget for two line items, not one.

## What you give up

Worth saying plainly, because it is the design and not a roadmap:

- **One microVM, one size.** 1 vCPU and 256 MiB, and no horizontal scaling. PocketBase is
  comfortable there for a small app; it is not where you put something with real traffic.
- **A deploy is a replace.** The old VM stops before the new one starts, because they share the
  volume. That is a few seconds of downtime, not blue/green.
- **The disk is local and unreplicated.** `nib apps export` gives you the binary and the whole
  `data/` directory as one `.tar.gz`. That is your backup, and you should take it.
- **One process.** No sidecar, no cron container, no separate `pocketbase superuser` invocation
  against the same volume.

If that list is disqualifying, you have outgrown this. If it is not, PocketBase is one file, and
running it should take about as long as downloading it.
