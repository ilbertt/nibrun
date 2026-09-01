<div align="center">
  <img src="apps/www/public/favicon.svg" alt="nibrun logo" width="128" />
  <h1>nibrun</h1>
  <p><em>One-click deployment for any single-binary app.</em></p>

[![runtime](https://img.shields.io/github/package-json/packageManager/ilbertt/nibrun?label=runtime&logo=bun&logoColor=fbf0df&color=fbf0df)](https://bun.com)
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
| ❌ ~~A VM to ssh into~~ | |
| ❌ ~~A firewall to open~~ | |
| ❌ ~~TLS to renew~~ | |
| ❌ ~~An OS to keep updated~~ | |

## What it is

nibrun is those two things and nothing else: a Firecracker microVM of its own (1 vCPU, 256 MiB)
and a `data/` directory that survives every redeploy. It answers on an HTTPS subdomain the moment
it boots, sleeps after five minutes idle, and wakes on the next request in ~120 ms.

If your app needs to be more than one machine, it has outgrown this — and that is not a roadmap,
it is the design.

## Preconfigured deployments

Open source that already ships as a single binary. One click, nothing to fill in:

- **[PocketBase](https://nibrun.com/deploy/pocketbase)** — a database, auth, file storage and an
  admin UI, in one file.
- **[Sharkord](https://nibrun.com/deploy/sharkord)** — a self-hosted chat server with voice,
  video and screen sharing.
- **[Boop](https://nibrun.com/deploy/boop)** — a self-hosted notification inbox for your own apps.

## Deploy your own app

Create an HTTP app (use the
[bun-full-stack-starter](https://github.com/ilbertt/bun-full-stack-starter) template) and compile
it to a single Linux x86_64 binary. Then deploy it:

### For Agents

Prepare the app and deploy it to nibrun using the [`deploy-to-nibrun`](./skills/deploy-to-nibrun/SKILL.md) skill.

Install it using:

```sh
npx skills add ilbertt/nibrun
```

### For Humans

**Use the dashboard**

Drag and drop the binary onto [app.nibrun.com](https://app.nibrun.com).

**Use the CLI**

```sh
curl -fsSL https://nibrun.com/install.sh | sh
```

```sh
nib run ./my-server
```

## Take it with you

```sh
nib apps export .
tar -xzf my-app.tar.gz
./my-server
```

The same binary you uploaded, the same bytes that were on the disk, and a `.env` of the variables
it was deployed with. There is no managed database to migrate off, because there never was one.
