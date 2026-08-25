<div align="center">
  <img src="apps/www/public/favicon.svg" alt="nibrun logo" width="128" />
  <h1>nibrun</h1>
  <p><em>Drop a binary. Get a server.</em></p>

[![skills.sh](https://skills.sh/b/ilbertt/nibrun)](https://skills.sh/ilbertt/nibrun)

</div>

Small apps don't need to scale. They need a machine and a disk.

## Why

A compiled binary is already a whole application in one file. Whatever language produced it,
nothing has to be installed on the other side. The only two things it still needs are somewhere
to run and somewhere to read and write files.

For an app that five people use, most of the rest is ceremony:

| What it usually gets | What it actually needs |
| --- | --- |
| ~~A container image~~<br>~~A managed Postgres~~<br>~~An object storage bucket~~<br>~~A load balancer, for one instance~~<br>~~A build pipeline~~<br>~~A YAML file you copied~~ | **A machine to run on**<br>**A disk to write to** |

nibrun is those two things, and nothing else.

## What you get

| | |
| --- | --- |
| **A machine to itself** | One Firecracker microVM per app. Nothing else runs inside it. |
| **A filesystem that persists** | `data/` is yours — a SQLite file, uploads, both. It survives every redeploy. |
| **A URL right away** | An HTTPS subdomain the moment it boots. No DNS to point, no certificate to renew. |
| **A way out** | The binary and its whole disk, as one `.tar.gz`, whenever you want it. |

## What it doesn't do

One instance per app, single writer. No autoscaling, no load balancing, no multi-region. An app
that needs those has outgrown this and should go somewhere else.

That is not a roadmap. It is the design.

## Get started

Create an HTTP app (use the [bun-full-stack-starter](https://github.com/ilbertt/bun-full-stack-starter)
template) and compile it to a single Linux x86_64 binary. Then deploy it:

### Use the dashboard

Drag the binary onto [app.nibrun.com](https://app.nibrun.com).

### Use the CLI

```sh
curl -fsSL https://nibrun.com/install.sh | sh
```

```sh
nib run ./my-server
```

### Let an agent do it

[`skills/deploy-to-nibrun`](./skills/deploy-to-nibrun/SKILL.md) teaches an agent the guest
contract, the commands and the tradeoffs:

```sh
npx skills add ilbertt/nibrun
```

## Take it with you

```sh
nib apps export .
tar -xzf my-app.tar.gz
PORT=3000 ./my-server
```

The same binary you uploaded, and the same bytes that were on the disk. There is no managed
database to migrate off, because there never was one.
