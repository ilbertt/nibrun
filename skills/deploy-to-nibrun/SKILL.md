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
| Own hostname | `NIBRUN_HOSTNAME` is set by the guest to the app's own `<slug>.nibrun.app` |
| Ephemeral | `TMPDIR=/tmp` is a tmpfs and is lost on restart. So is everything outside `/app/data` |
| Resources | 1 vCPU, 512 MiB RAM |
| `HOME` | `/app` |
| URL | `https://<slug>.nibrun.app`, live as soon as it boots |

An app that writes its SQLite file and its uploads under `./data` and reads `PORT` needs no
configuration to run here. A `PORT` or `NIBRUN_HOSTNAME` you set yourself is ignored — the guest
owns both.

A binary that needs its own absolute URL — an OAuth redirect, a webhook it registers, a link in
an email — builds it from `NIBRUN_HOSTNAME` rather than being told it, and falls back to whatever
it uses when it is not on nibrun.

## Deploying

```sh
curl -fsSL https://nibrun.com/install.sh | sh   # installs `nib` to ~/.local/bin
nib login                                       # device flow: approve it in the browser
```

`nib login` waits on a human approving it in a browser, so an agent that finds itself signed out
asks the user to run it rather than trying to drive it.

Whatever the binary needs from its environment has to be there on the **first** deploy: a process
that exits over a missing variable never starts serving, and the deploy fails with it. Read off
what it requires — a `.env.example`, whatever it loads config from — before deploying, not after.

First deploy — creates the app:

```sh
nib run ./my-server --name my-app --port 8080
```

`--port` is what the binary listens on inside the guest — read it off the app rather than carrying
a number over from an example. It is the port the guest then hands back as `PORT`, and it defaults
to `3000`.

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
nib run ./my-server --app my-app --env STRIPE_SECRET_KEY=sk_live_... --env LOG_LEVEL=debug
nib run ./my-server --app my-app --unset LOG_LEVEL
```

`nib apps list` finds the slug again when a later session has to redeploy, and `nib apps logs` says
why one that was created never came up — worth reaching for, since serving is only a TCP connect
and a broken process can hold the port. `nib --help` lists the rest — domains, filesystem, export,
delete.

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

One self-contained `linux-x86_64` file — static, or dynamically linked against glibc, which the
rootfs carries. It has to be built *for* that target: a binary compiled on a Mac, or for arm64, is
the most common reason a first deploy never boots.

**If the repo already builds one, run its build.** A project that ships a binary usually wraps more
than a compiler invocation — assets embedded, constants substituted at build time, a frontend
compiled first — and a hand-rolled command silently skips all of it, producing something that links
and then dies on boot. [bun-full-stack-starter](https://github.com/ilbertt/bun-full-stack-starter)
is one such: `bun run build` gives `backend/dist/app` with the frontend and the migrations inside
it, defaulting to `PORT` 3000 and `./data`.

A Bun repo with nothing to inherit compiles one itself with `bun build --compile`, targeting
`bun-linux-x64`. Embedding an asset directory, bytecode, build-time constants — all flags on that
same command, and worth reading [Bun's single-file executable
docs](https://bun.com/docs/bundler/executables) for rather than recalling: a flag invented from
memory is how a binary ends up missing the files it expects to carry.
