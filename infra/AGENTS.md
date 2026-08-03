# infra

AWS, one stack, two machine classes: the control plane runs the compose stack,
app hosts run tenant microVMs. `bootstrap/` is one-time CloudFormation,
`terraform/` owns the resources, `pg-backup/` is the nightly dump sidecar,
`caddy/` is the control-plane proxy's static config, plus the origin-pull CA
both proxies authenticate the edge against. `deploy/` holds only the scripts
that run *on* a box, which is why they are shell — an instance has no Bun.
Everything CI runs lives in `@repo/internal-scripts`.

The Terraform explains itself; read it rather than a description of it here.

MinIO stands in for S3 locally only — `docker-compose.prod.yml` parks it on an
inactive profile and points the api at the real bucket.

Config carries its component's prefix — `API_`, `POSTGRES_`, `PG_BACKUP_`,
`CADDY_`, `DOZZLE_` — unless more than one component reads it, and keeps one
name from the Terraform output through the SSM command to the `.env` the box
writes. Nothing is aliased in transit, so nothing can drift.

## First run

```sh
# Console → CloudFormation → upload bootstrap/github-oidc-bootstrap.yaml, once.
cd infra/terraform
terraform init
terraform apply # prompts for every variable without a default
```

Then point an A record at `terraform output public_ip`, **proxied** (orange
cloud) — one per hostname, `api_hostname` and `dozzle_hostname`.

User apps live in a second zone, `app_domain`, on a **different registrable
domain**: a tenant app under the dashboard's own domain could set a cookie the
browser would then send to the api. Terraform refuses a value that shares one.
One wildcard `*.<app_domain>` record, proxied, pointed at
`terraform output app_host_public_ips` — and an AAAA at
`app_host_public_ipv6s` — covers the whole fleet, so there is nothing per app in
DNS. Neither address is elastic, so a stop/start means re-pointing both.

Sign-in needs a GitHub OAuth App whose callback URL is
`https://<api_hostname>/api/auth/callback/github`.

Three zone settings, none of them in code, **in both zones**: SSL/TLS **Full
(strict)**; an **Origin Certificate** (ECC — Cloudflare's edge is its only
client), whose two halves are a proxy's TLS inputs; and **Authenticated Origin
Pulls → Global** on. Enable that last one before the first deploy carrying a
proxy — Caddy requires the client certificate it turns on, and without it every
visitor gets a `525`.

An origin certificate is issued per zone, which is why there are two:
`caddy_tls_*` for the control plane and `app_host_caddy_tls_*` for the app
hosts. The control plane's must name **every** hostname its proxy serves — both
of them today. Caddy serves the one pair from every site block, so a hostname
missing from it fails the handshake rather than falling back to anything; adding
a hostname later means reissuing that certificate and updating both halves, not
issuing a second one. The app hosts' is a wildcard for `*.<app_domain>`
precisely so that creating an app is never a certificate operation.

## Deploying

`.github/workflows/cd.yml`, on every push to main: build both images, apply
Terraform, upload a bundle to S3, then trigger `on_box_deploy.sh` over SSM
RunCommand — no SSH, no key material in CI. Secrets are never passed through:
Terraform generates them into `/nibrun/…` and the instance reads them with its
own role. Terraform runs under the admin bootstrap role; everything after it
drops to the scoped deploy role.

What the deploy needs arrives as repository variables and secrets — `cd.yml`
holds the current set. Public values are variables, the rest are secrets, and
Terraform reads each into an SSM parameter the instance decrypts for itself, so
no secret reaches the deploy's own environment — RunCommand keeps its parameters
in command history, in the clear, for 30 days.
Both GHCR packages must be public — the box pulls with no registry credentials.

`workflow_dispatch` takes `allow_destroy` for the times a plan legitimately
replaces something.
