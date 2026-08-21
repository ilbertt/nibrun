<div align="center">
  <img src="apps/www/public/favicon.svg" alt="nibrun logo" width="128" />
  <h1>nibrun</h1>
  <p><em>Drop a binary. Get a server.</em></p>

[![skills.sh](https://skills.sh/b/ilbertt/nibrun)](https://skills.sh/ilbertt/nibrun)

</div>

Each binary gets a microVM of its own, a persistent filesystem, and an HTTPS URL. No Dockerfile,
no YAML, no cluster.

## Get started

Create an HTTP app (use the [bun-full-stack-starter](https://github.com/ilbertt/bun-full-stack-starter)
template) and compile it to a single binary. Then deploy it:

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
