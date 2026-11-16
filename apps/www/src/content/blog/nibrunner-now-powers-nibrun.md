---
title: nibrunner now powers nibrun
description: nibrun's apps now run on nibrunner, a self-hostable microVM orchestrator written in Rust.
date: 2026-11-16
---

nibrun now uses [nibrunner](https://github.com/ilbertt/nibrunner) to run deployed apps.
It's a self-hostable microVM orchestrator written in Rust, built on Firecracker.

nibrun's [host agent](https://github.com/ilbertt/nibrun/blob/main/apps/agent/src/lib/nibrunner/bridge.ts)
downloads the binaries and writes a desired-state file describing each app: what to run,
which volume to attach, and which hostnames to serve. nibrunner reads it, starts the
microVMs, and reports their state back. It also routes requests and
[puts idle apps to sleep, then wakes them when traffic arrives](https://nibrunner.dev/docs/guides/sleep-and-wake).

nibrun handles accounts, uploads, the dashboard and CLI. nibrunner can also run on
a machine of your own, independently of nibrun.

If you deploy on nibrun, the workflow is the same: upload a binary, get an HTTPS URL,
and keep persistent files in `data/`.

To run nibrunner yourself, you'll need a Linux x86_64 machine with `/dev/kvm`, either
bare metal or a VPS with nested virtualization. Start with the
[installation guide](https://nibrunner.dev/docs/getting-started/installation), then
[deploy an app](https://nibrunner.dev/docs/getting-started/deploy-an-app).
