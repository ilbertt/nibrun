---
name: deploy-to-nibrun
description: Deploy a compiled binary to nibrun and run it as an HTTPS service. Use when asked to deploy, ship, host or run a self-contained server binary (Bun, Go, Rust, Zig, C) or a folder of static assets on nibrun, when working in a repo that targets nibrun, or when deciding whether nibrun fits an app.
---

# Deploy to nibrun

nibrun takes one compiled binary and gives it a microVM of its own, a persistent filesystem, and
an HTTPS URL. No Dockerfile, no YAML, no cluster.

Sign in, build for Linux x86_64, `nib run`, then ask the URL for something. What that path does not
need is below it: [copying an app](#copying-an-app), [the guest contract](#the-guest-contract),
[naming a runtime value](#naming-a-runtime-value), [a second public port](#a-second-public-port),
and [what nibrun does not do](#tradeoffs).

## 1. Sign in

```sh
nib apps list
```

Both halves in one command: `command not found` means the CLI is not installed, `Not signed in.`
means it is not signed in.

```sh
curl -fsSL https://nibrun.com/install.sh | sh   # installs `nib` to ~/.local/bin
nib login                                       # device flow: approve it in the browser
```

`nib login` waits on a human approving it in a browser, so an agent that finds itself signed out
asks the user to run it rather than trying to drive it.

## 2. Build the binary

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

Three things to read off the binary before deploying rather than after:

- **The port it listens on**, and that it binds `0.0.0.0` rather than `127.0.0.1`. The guest hands
  the number back as `NIBRUN_HTTP_PORT` and `PORT`, so an app that reads either needs no
  configuration here.
- **Where it writes.** Only `/app/data` survives a redeploy, and an app that keeps its SQLite file
  and its uploads under `./data` is already there.
- **What it needs from the environment**, off a `.env.example` or whatever it loads config from. It
  has to be there on the **first** deploy: a process that exits over a missing variable never
  starts serving, and the deploy fails with it.

**A folder of static assets has no binary to build**: `nib` is one, and `nib serve` answers for
whatever folder it is given, on the port the guest hands it. So the folder goes up as the app's
`data/`, and the CLI's own Linux build as the binary that serves it:

```sh
nib run "https://github.com/ilbertt/nibrun/releases/latest/download/nib-linux-x64 serve /app/data" --name my-site --data-folder ./dist
```

A path naming a directory answers with its `index.html`, and a miss with the folder's own
`404.html` where it has one; `serve /app/data --single-page` answers every miss with the root
`index.html` instead, for a SPA whose routes exist only in the browser. No `--port`: `nib serve`
binds whichever port the guest assigns. The assets ride in as data, which goes up only as the app
is created — a rebuilt site is a new app, at a new URL, and a custom domain (`nib apps domains`)
is what keeps an address across that.

## 3. Deploy

First deploy — creates the app:

```sh
nib run ./my-server --name my-app --port 8080
```

`--port` is the HTTP port the binary listens on inside the guest — read it off the app rather
than carrying a number over from an example. It is the number the guest hands back as
`NIBRUN_HTTP_PORT` and `PORT`, and it defaults to `3000`.

An app can be created with its `data/` already holding something — a seeded SQLite file, a corpus,
fixtures a first run would otherwise have to write:

```sh
nib run ./my-server --name my-app --data-folder ./seed
```

It takes a folder, or a `.tar.gz` or `.zip` that already holds one — the zip Finder or Explorer
made goes as it stands. Either way **the root of the archive becomes the root of `data/`**: a
folder is packed from the inside, so `./seed/app.db` arrives as `/app/data/app.db`, and bundling
the folder rather than its contents puts every file one directory deeper than the app looks. Up to
1 GiB sent and 2 GiB unpacked, and only as the app is created: this and the app writing its own
files are the whole of how anything gets onto the volume. A zip made anywhere but unix carries no
permissions, so an executable bit does not survive one.

**Every deploy after that must name the app**, or a non-interactive shell creates a second one.
`nib apps list` finds the slug again when a later session has to redeploy:

```sh
nib run ./my-server --app my-app
```

Environment variables are an **edit**, not a replacement — anything a deploy does not name is left
alone, so secrets are set once:

```sh
nib run ./my-server --app my-app --env STRIPE_SECRET_KEY=sk_live_...
```

Arguments for the binary go inside the quotes, not after them:

```sh
nib run "./my-server serve --verbose" --app my-app
```

The binary may be an https url instead of a path, and nibrun fetches it rather than this machine
uploading it:

```sh
nib run https://github.com/me/my-app/releases/download/v1/my-server --app my-app
```

Changing only how the binary starts is `nib apps update`, which runs the one the app already has
rather than asking for it again. What no flag names is left alone:

```sh
nib apps update --app my-app --env LOG_LEVEL=debug
nib apps update --app my-app --args "serve --verbose"
```

`nib run` waits until the deployment is actually serving and prints the URL. Or drag the binary
onto [app.nibrun.com](https://app.nibrun.com) — same thing, no CLI.

Every option a deploy takes is listed by `nib run anything --help` — any word will do in place of
the binary, because the help does not read it, and `nib run --help` on its own answers with the
subcommand rather than the options. What is below is what `--help` does not say.

## 4. Verify

Serving is only a TCP connect, and a broken process can hold the port while answering nothing. So
ask the URL for something:

```sh
curl -fsS https://my-app.nibrun.app/
```

`nib apps logs --app my-app` says why one that was created never came up, and what one that did is
complaining about. `nib --help` lists the rest — status, domains, filesystem, export, delete.

## Copying an app

An export is a `.tar.gz` holding `data/`, the binary that ran against it, and a `.env` of the
variables it was deployed with — which is everything a second app is rebuilt from, whether that is
a staging copy, a restore, or a move to another account:

```sh
nib apps export ./my-app.tar.gz --app my-app
tar xzf my-app.tar.gz                       # -> data/  my-server  .env
nib run ./my-server --name my-app-copy --data-folder ./data --port 8080
```

`--data-folder ./data` and not the bundle as a whole: only `data/` was the volume, and the binary
and the `.env` unpacked beside it were never on it. Nothing outside the volume comes across either
— port, arguments and environment are given to the copy the way any new app is given them, with the
exported `.env` as the record of what the original had.

## The guest contract

Everything the binary can count on, and nothing else:

| | |
| --- | --- |
| Platform | Linux **x86_64**, glibc (Debian rootfs) |
| Working directory | `/app` — a tmpfs the app does not own |
| Persistent volume | `/app/data` — 8 GiB, survives every redeploy. `NIBRUN_DATA_DIR` names it |
| Port | `NIBRUN_HTTP_PORT`, and `PORT` beside it; the app **must** listen on it, on `0.0.0.0` |
| Own hostname | `NIBRUN_HOSTNAME` is set by the guest to the app's own `<slug>.nibrun.app` |
| Second port | Only with `--extra-public-port`: `NIBRUN_EXTRA_PUBLIC_PORT` on `NIBRUN_PUBLIC_IPV4`, TCP and UDP, assigned rather than chosen, and reached at that number and no other |
| Ephemeral | `TMPDIR=/tmp` is a tmpfs and is lost on restart. So is everything outside `/app/data` |
| Resources | 1 vCPU, 256 MiB RAM |
| `HOME` | `/app`, which the app cannot write: a binary that puts a cache or a config file under `~` dies of `EACCES` before it ever serves. `/app/data` is the only path it can write |
| URL | `https://<slug>.nibrun.app`, live as soon as it boots |

The guest sets three names of its own — `NIBRUN_HTTP_PORT`, `NIBRUN_HOSTNAME`, `NIBRUN_DATA_DIR` —
and any of them you set yourself is ignored, as is `PORT`, which carries the same number as
`NIBRUN_HTTP_PORT` under the name every other host uses. `HOME` and `TMPDIR` are defaults rather
than fixed, so one you set yourself is what the binary reads — `HOME=${NIBRUN_DATA_DIR}` is how a
binary that insists on writing under `~` is given a home it owns.

A binary that needs its own absolute URL — an OAuth redirect, a webhook it registers, a link in
an email — builds it from `NIBRUN_HOSTNAME` rather than being told it, and falls back to whatever
it uses when it is not on nibrun.

## Naming a runtime value

A binary that insists on a variable name of its own reaches the same values through it —
`APP_BASE_URL=https://${NIBRUN_HOSTNAME}`, `DATABASE_URL=file:${NIBRUN_DATA_DIR}/app.db` — and the
guest expands it before exec. Only the `NIBRUN_` names above expand, and only those: a secret
holding a `$` arrives untouched, `${PORT}` is not one of them, and anything else is refused when
you deploy it.

## A second public port

An app needing a port HTTP cannot carry — WebRTC media, a game server, anything on UDP — asks for
one with `--extra-public-port`, and is told where it landed as `NIBRUN_PUBLIC_IPV4` and
`NIBRUN_EXTRA_PUBLIC_PORT`. Neither is discoverable from inside the guest, so an app that tells a
peer where to reach it announces that pair: it is the same number end to end, which is what makes
announcing it correct.

Ask for the port in the same change that names it:

```sh
nib apps update --app my-app --extra-public-port --env 'ANNOUNCED_IP=${NIBRUN_PUBLIC_IPV4}'
```

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
