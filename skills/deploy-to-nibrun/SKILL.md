---
name: deploy-to-nibrun
description: Deploy a compiled binary to nibrun and run it as an HTTPS service. Use when asked to deploy, ship, host or run a self-contained server binary (Bun, Go, Rust, Zig, C) on nibrun, when working in a repo that targets nibrun, or when deciding whether nibrun fits an app.
---

# Deploy to nibrun

nibrun takes one compiled binary and gives it a microVM of its own, a persistent filesystem, and
an HTTPS URL. No Dockerfile, no YAML, no cluster.

## The guest contract

Everything the binary can count on, and nothing else:

| | |
| --- | --- |
| Platform | Linux **x86_64**, glibc (Debian rootfs) |
| Working directory | `/app` |
| Persistent volume | `/app/data` — 8 GiB, survives every redeploy |
| Port | `PORT` is set by the guest; the app **must** listen on it, on `0.0.0.0` |
| Ephemeral | `TMPDIR=/tmp` is a tmpfs and is lost on restart. So is everything outside `/app/data` |
| Resources | 1 vCPU, 512 MiB RAM |
| `HOME` | `/app` |
| URL | `https://<slug>.nibrun.app`, live as soon as it boots |

An app that writes its SQLite file and its uploads under `./data` and reads `PORT` needs no
configuration to run here. A `PORT` you set yourself is ignored — the guest owns it.

## Deploying

```sh
curl -fsSL https://nibrun.com/install.sh | sh   # installs `nib` to ~/.local/bin
nib login                                       # device flow: approve it in the browser
```

First deploy — creates the app:

```sh
nib run ./my-server --name my-app --port 3000
```

`--port` is what the binary listens on inside the guest, and it defaults to `3000`. It is the port
the guest then hands back as `PORT`.

**Every deploy after that must name the app**, or a non-interactive shell creates a second one:

```sh
nib run ./my-server --app my-app
```

`nib run` waits until the deployment is actually serving and prints the URL. Add `--detach` to
return as soon as it is created.

Arguments for the binary go inside the quotes, not after them:

```sh
nib run "./my-server serve --verbose" --app my-app
```

Environment variables are an **edit**, not a replacement — anything a deploy does not name is left
alone, so secrets are set once:

```sh
nib run ./my-server --app my-app --env BASE_URL=https://my-app.nibrun.app --env LOG_LEVEL=debug
nib run ./my-server --app my-app --unset LOG_LEVEL
```

`BASE_URL` is the usual chicken-and-egg: deploy once, read the URL it prints, then set it.

## The rest of the CLI

| Command | |
| --- | --- |
| `nib apps list` | slugs, states, when each last changed |
| `nib apps logs --app <slug>` | stdout and stderr, followed until you stop it (`--timerange 5m` for history) |
| `nib apps files ls [path] --app <slug>` | browse the volume without shelling in |
| `nib apps domains --app <slug>` | hostnames it answers on |
| `nib apps domains add <hostname> --app <slug>` | prints the two DNS records to add |
| `nib apps export ./backup.tar.gz --app <slug>` | the binary and the whole disk, as one archive |
| `nib apps delete --app <slug> --yes` | volume, binaries and exports. No undo |

Every command takes `--app`; without it and without a terminal to ask at, it fails rather than
guesses. `nib apps list` is the exception.

Or drag the binary onto [app.nibrun.com](https://app.nibrun.com) — same thing, no CLI.

## Tradeoffs

Worth saying out loud before recommending it:

- **One microVM per app.** No horizontal scaling and no load balancing. Vertical only.
- **A deploy is a replace.** The old VM is stopped before the new one starts, because they share
  one volume — so there are a few seconds of downtime, and no blue/green or canary.
- **A local disk, not a distributed one.** Ideal for SQLite, uploads, caches. It is not
  replicated, so an export (`nib apps export`) is your backup.
- **The binary is the unit.** The guest boots yours and nothing else — no sidecar, no cron
  container, no managed database next to it.
- **512 MiB and 1 vCPU by default**, and the OOM killer reaches for the tenant first.
- **Health is a TCP connect** to `PORT` by default. A process that accepts connections while
  broken reads as healthy.

It fits a single-binary app that owns its own state — an internal tool, a small SaaS, a demo, a
side project. It does not fit anything that needs to be several machines.

## Producing a binary

Any self-contained `linux-x64` binary — static, or dynamically linked against glibc, which the
rootfs carries. With Bun:

```sh
bun build --compile --target=bun-linux-x64 --outfile ./my-server ./src/main.ts
```

[bun-full-stack-starter](https://github.com/ilbertt/bun-full-stack-starter) is a template already
shaped this way: an Elysia API and a React SPA compiled into one binary, with the frontend and the
migrations embedded, defaulting to `PORT` 3000 and `./data`.
