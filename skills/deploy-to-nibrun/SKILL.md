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
| Persistent volume | `/app/data` — 8 GiB, survives every redeploy. `NIBRUN_DATA_DIR` names it |
| Port | `NIBRUN_HTTP_PORT`, and `PORT` beside it; the app **must** listen on it, on `0.0.0.0` |
| Own hostname | `NIBRUN_HOSTNAME` is set by the guest to the app's own `<slug>.nibrun.app` |
| Second port | Only with `--extra-public-port`: `NIBRUN_EXTRA_PUBLIC_PORT` on `NIBRUN_PUBLIC_IPV4`, TCP and UDP, assigned rather than chosen, and reached at that number and no other |
| Ephemeral | `TMPDIR=/tmp` is a tmpfs and is lost on restart. So is everything outside `/app/data` |
| Resources | 1 vCPU, 256 MiB RAM |
| `HOME` | `/app` |
| URL | `https://<slug>.nibrun.app`, live as soon as it boots |

An app that writes its SQLite file and its uploads under `./data` and reads `PORT` needs no
configuration to run here. The guest sets three names of its own — `NIBRUN_HTTP_PORT`,
`NIBRUN_HOSTNAME`, `NIBRUN_DATA_DIR` — and any of them you set yourself is ignored, as is `PORT`,
which carries the same number as `NIBRUN_HTTP_PORT` under the name every other host uses. `HOME`
and `TMPDIR` are defaults rather than owned, so one you set yourself is what the binary reads.

An app needing a port HTTP cannot carry — WebRTC media, a game server, anything on UDP — asks for
one with `--extra-public-port`, and is then set two more: `NIBRUN_PUBLIC_IPV4` and
`NIBRUN_EXTRA_PUBLIC_PORT`. You do not pick the number; nibrun assigns it. Bind that port
and announce that pair; it is the same number end to end, which is what makes announcing it
correct. Neither is discoverable from inside the guest.

A binary that needs its own absolute URL — an OAuth redirect, a webhook it registers, a link in
an email — builds it from `NIBRUN_HOSTNAME` rather than being told it, and falls back to whatever
it uses when it is not on nibrun.

One that insists on a variable name of its own reaches the same values through it: a value may
name a runtime one — `APP_BASE_URL=https://${NIBRUN_HOSTNAME}`,
`DATABASE_URL=file:${NIBRUN_DATA_DIR}/app.db` — and the guest expands it before exec. Only that
prefix expands, so a secret holding a `$` arrives untouched, and `NIBRUN_HTTP_PORT`,
`NIBRUN_HOSTNAME`, `NIBRUN_DATA_DIR`, `NIBRUN_PUBLIC_IPV4` and `NIBRUN_EXTRA_PUBLIC_PORT` are the
whole of what may be named — `${PORT}` is not one of them — with anything else refused when you
deploy it.

The last two are set only for an app that asked for a second port, and naming one the app was not
given is refused when you deploy it. Ask for the port in the same change that names it:

```sh
nib apps update --app my-app --extra-public-port --env 'ANNOUNCED_IP=${NIBRUN_PUBLIC_IPV4}'
```

`--extra-public-port=false` gives the port up. Saying nothing about it leaves it as it is.

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

`--port` is the HTTP port the binary listens on inside the guest — read it off the app rather
than carrying a number over from an example. It is the number the guest hands back as
`NIBRUN_HTTP_PORT` and `PORT`, and it defaults to `3000`.

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

Changing only how the binary starts is `nib apps update`, which runs the one the app already has
rather than asking for it again. What no flag names is left alone:

```sh
nib apps update --app my-app --env LOG_LEVEL=debug
nib apps update --app my-app --args "serve --verbose"
```

`nib apps list` finds the slug again when a later session has to redeploy, and `nib apps logs` says
why one that was created never came up — worth reaching for, since serving is only a TCP connect
and a broken process can hold the port. `nib --help` lists the rest — domains, filesystem, export,
delete.

Or drag the binary onto [app.nibrun.com](https://app.nibrun.com) — same thing, no CLI.

## Tradeoffs

Worth saying out loud before recommending it:

- **One microVM per app, one size.** No horizontal scaling, no load balancing, no resizing.
- **A deploy is a replace.** The old VM is stopped before the new one starts, because they share
  one volume — so there are a few seconds of downtime, and no blue/green or canary.
- **A local disk, not a distributed one.** Ideal for SQLite, uploads, caches. It is not
  replicated, so an export (`nib apps export`) is your backup.
- **The binary is the unit.** The guest boots yours and nothing else — no sidecar, no cron
  container, no managed database next to it.
- **256 MiB and 1 vCPU**, sized by nibrun rather than configured by you, and the OOM killer
  reaches for the tenant first.
- **Health is a TCP connect** to that port, and not something you configure. A process that accepts
  connections while broken reads as healthy.
- **A crash loop is fatal.** The guest restarts your process on a fixed budget you do not set;
  once it runs out the app is `failed` rather than restarted forever.

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
