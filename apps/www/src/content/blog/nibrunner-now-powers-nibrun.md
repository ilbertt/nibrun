---
title: nibrunner now powers nibrun
description: nibrun's apps now run on nibrunner, a self-hostable microVM orchestrator written in Rust.
date: 2026-11-16
---

nibrun now uses [nibrunner](https://github.com/ilbertt/nibrunner) to run deployed apps.
It's a self-hostable microVM orchestrator written in Rust, built on Firecracker.

The first versions of nibrun used a TypeScript agent to manage the microVMs. After a
few iterations, we designed nibrunner to extract that work into a separate project
that could be self-hosted.

The key decision was to make one file,
[`desired.json`](https://nibrunner.dev/docs/reference/desired), the source of truth
for the host's desired state. It describes the apps, their binaries, volumes and hostnames.
nibrunner reads it and makes the running system match, reporting the result in
`reported.json`.

nibrun still needs an agent beside nibrunner to connect it to the rest of the
platform. The agent talks to nibrun's REST API, downloads the binaries, writes
`desired.json`, and sends nibrunner's reported state back to the API. When you
self-host nibrunner, you can write the file yourself.

nibrunner also runs
[Linux amd64 OCI images, including Docker images](https://nibrunner.dev/docs/guides/layers#from-an-oci-image)
inside microVMs. That gives us a way to support image deployments on nibrun alongside
single binaries. Its native
[Cloudflare Access support](https://nibrunner.dev/docs/guides/cloudflare-access)
lets us add Access protection too, verifying tokens before forwarding requests or
waking an app.

We also dropped Caddy. nibrunner's embedded proxy now handles the whole request:
it [wakes a sleeping app](https://nibrunner.dev/docs/guides/sleep-and-wake), waits for
it to be ready, forwards the request and returns the response.

That path is instrumented inside nibrunner, with more detailed
[metrics](https://nibrunner.dev/docs/guides/logs-and-metrics#metrics) for VM lifecycle
timings, request outcomes and resource usage. These help us find bottlenecks and
check whether our fixes improve performance.

The [nibrunner.dev](https://nibrunner.dev) documentation site itself runs on nibrun.

To run nibrunner yourself, you'll need a Linux x86_64 machine with `/dev/kvm`, either
bare metal or a VPS with nested virtualization. Start with the
[installation guide](https://nibrunner.dev/docs/getting-started/installation), then
[deploy an app](https://nibrunner.dev/docs/getting-started/deploy-an-app).

Click **Deploy on nibrun** below to try the faster runtime with your own app.
