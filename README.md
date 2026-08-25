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
| ❌ ~~A container image~~ | ✅ **A machine to run on** |
| ❌ ~~A managed Postgres~~ | ✅ **A disk to write to** |
| ❌ ~~An object storage bucket~~ | |
| ❌ ~~A load balancer, for one instance~~ | |
| ❌ ~~A build pipeline~~ | |
| ❌ ~~A YAML file you copied~~ | |

## What you get

nibrun is those two things and nothing else: a Firecracker microVM of its own, and a `data/`
directory that survives every redeploy. It answers on an HTTPS subdomain the moment it boots.

If your app needs to be more than one machine, it has outgrown this — and that is not a roadmap,
it is the design.

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
./my-server
```

The same binary you uploaded, and the same bytes that were on the disk. There is no managed
database to migrate off, because there never was one.
