---
title: Small apps don't need to scale
description: Most software is small and stays small. Deploying it like it isn't makes it hard to leave.
date: 2026-08-27
---

Most software is small. Five people use it, it holds a couple of gigabytes, and on a busy day it
serves a few thousand requests. Internal tools, a booking page for one clinic, a dashboard someone
opens on Mondays.

It still gets deployed like it might be the next big thing: a container image, a managed Postgres,
an object storage bucket, a load balancer sitting in front of a single instance.

That costs money every month, but the real problem turns up when you want to leave. The app isn't
in one place anymore. It's an image, plus a database someone else runs, plus a bucket, plus
environment variables you typed into a web form, plus a YAML file wiring the four of them
together. Exporting the data is easy. Rebuilding that arrangement somewhere else is the actual
work.

nibrun does the boring version instead. You give it one compiled binary and it gets a microVM to
itself (1 vCPU, 256 MiB) with 8 GiB of disk that survives redeploys. Write your SQLite file and
your uploads to `data/` and you're done. It's online at `https://<slug>.nibrun.app` as soon as it
boots, or on your own domain if you point one at it. No image to build, no database to provision,
no bucket, and no load balancer in front of one instance.

![The nibrun home page, with a dashed box reading "Drop it here"](/blog/drop-a-binary.png "Drag the binary onto the page. That's the whole deploy.")

When you want out:

```sh
nib apps export ./my-app.tar.gz
```

That's the binary, everything in `data/`, and a `.env` with the variables it was running with.
Unzip it on any Linux box, run the binary, and you have the same app back with the same data in
it.

The catch is that this only works for apps that fit on one machine. There's no horizontal scaling,
a deploy means a few seconds of downtime while the old VM stops and the new one starts, and the
disk isn't replicated, so that export is also your backup. If your app needs to be more than one
machine, nibrun is the wrong tool. Most small apps never do.
