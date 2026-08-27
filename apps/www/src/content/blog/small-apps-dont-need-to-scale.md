---
title: Small apps don't need to scale
description: Most software is small. It gets deployed as if it might be big. Then you try to leave.
date: 2026-08-27
---

Most software is small. Not small as in unfinished. Small as in five people use it, it holds a
couple of gigabytes, and on its busiest day it serves a few thousand requests.

An internal tool. A booking page for one clinic. A dashboard three people open on Mondays. The
thing you built for your own team and never told anyone about.

None of it needs to scale. All of it gets deployed as if it might.

## Built for traffic that never came

The default shape of a deployed app assumes it will be big one day. A load balancer, in front of
one instance. A managed Postgres, for a database that would fit in a single file. An object
storage bucket, for two hundred uploads. A container image, so the thing can be scheduled onto
any machine, by a platform that will only ever put it on one.

None of that is wrong. It is just sized for a problem you do not have.

And you pay for it twice. Once a month, and again every time you touch the app.

## The exit test

Here is a question worth asking before you deploy anything.

If this platform tripled its price tomorrow, how long would it take you to leave?

For a small app on a normal platform, the honest answer is a weekend. If you are lucky. Not
because anyone is holding your data hostage. Postgres has `pg_dump` and the bucket speaks S3.
The problem is that the app is not in one place any more.

It is a container image, plus a managed database, plus a bucket, plus environment variables typed
into a web form, plus a YAML file describing how those four are wired together. The rows and the
uploads are the easy part. What you cannot export is the arrangement.

You do not move a small app. You reassemble one.

## A machine and a disk

nibrun is the other answer. Not a smaller platform. A different unit.

You give it one compiled binary. It gets a Firecracker microVM of its own, 1 vCPU and 256 MiB,
and nothing else runs in it. `data/` is 8 GiB that survives every redeploy: put a SQLite file
there, put uploads there, put both. It answers on `https://<slug>.nibrun.app` the moment it boots,
and on your own domain as soon as you point one at it.

There is no image to build, because the binary is the artifact. There is no database to
provision, because the disk is right there. There is no bucket, for the same reason. There is no
load balancer, because there is one instance and there was always going to be one instance.

And the exit test has an answer:

```sh
nib apps export ./my-app.tar.gz
```

That is the binary, the entire `data/` directory as it stood on disk, and a `.env` of the
variables it ran with. Unzip it on a Linux box and run the binary. It is the same app, with the
same rows and the same uploaded files. There is no managed database to migrate off, because there
was never a managed database.

Leaving costs you a download. That is the part we actually care about.

## Where it does not fit

Worth saying plainly, because it is the design and not a roadmap.

One microVM per app, at one size. No horizontal scaling and no load balancing. A deploy stops the
old VM before starting the new one, because they share the volume, so it is a few seconds of
downtime rather than blue/green. The disk is local and not replicated, which is what makes that
export your backup rather than a convenience. The guest boots your binary and nothing else. No
sidecar, no cron container, no second process.

If your app has to be several machines, it has outgrown this. That is not a roadmap item. It is
the shape of the thing.

## The whole product

Small apps do not need to scale. They need somewhere to run, somewhere to write files, and a way
to pick the whole thing up and walk out with it.

That is all nibrun is, and it is on purpose.
