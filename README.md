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

A container image, a managed Postgres, an object store and a load balancer in front of a single
instance are not infrastructure for an app five people use. They are overhead you carry because
that is the shape every platform requires.

nibrun is the machine and the disk, and nothing else.

## What you get

| | |
| --- | --- |
| **A machine to itself** | One Firecracker microVM per app. Nothing else runs inside it. |
| **A filesystem that persists** | `data/` is yours — a SQLite file, uploads, both. It survives every redeploy. |
| **A URL right away** | An HTTPS subdomain, the moment it boots. |
| **A way out** | The binary and its whole disk, as one `.tar.gz`, whenever you want it. |
| ~~Autoscaling~~ | One instance per app, single writer. That is the whole concurrency model. |
| ~~A load balancer~~ | There is one place your app runs. |
| ~~A managed database~~ | Your database is a file on your disk. |
| ~~Object storage~~ | Your uploads are files on your disk. |
| ~~A Dockerfile~~ | No YAML and no build pipeline either. You deploy the binary you built. |

The struck-through rows are not a roadmap. An app that genuinely needs one of them is better off
somewhere else.

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
