# infra

AWS, one stack, one box. `bootstrap/` is one-time CloudFormation, `terraform/`
owns the resources, `pg-backup/` is the nightly dump sidecar, `caddy/` is the
proxy's static config. `deploy/` holds only the two scripts that run *on* the
box, which is why they are shell — the instance has no Bun. Everything CI runs
lives in `@repo/internal-scripts`. The EC2 instance runs the compose stack — api, Postgres and Dozzle — behind an
elastic IP, with a persistent EBS volume at `/data` and three S3 buckets:
artifacts for user uploads, backups for Postgres dumps, deploy for runtime
bundles. MinIO stands in for S3 locally only — `docker-compose.prod.yml` parks
it on an inactive profile and points the api at the real bucket.

Caddy terminates TLS on 443 and is the whole public surface; the api stays on
loopback and on the compose network, which is the path fleet-host agents take
later. Compute hosts and the CDN still come later.

Config carries its component's prefix — `API_`, `POSTGRES_`, `PG_BACKUP_`,
`CADDY_`, `DOZZLE_` — and keeps one name from the Terraform output through the
SSM command to the `.env` the box writes. Nothing is aliased in transit, so
nothing can drift.

## First run

```sh
# Console → CloudFormation → upload bootstrap/github-oidc-bootstrap.yaml, once.
cd infra/terraform
terraform init
terraform apply # prompts for every variable without a default
```

Then point an A record at `terraform output public_ip`, **proxied** (orange
cloud) — one per hostname, `api_hostname` and `dozzle_hostname`.

Sign-in needs a GitHub OAuth App whose callback URL is
`https://<api_hostname>/api/auth/callback/github`.

Three zone settings, none of them in code: SSL/TLS **Full (strict)**; an
**Origin Certificate** (ECC — Cloudflare's edge is its only client), whose two
halves are the proxy's TLS inputs; and **Authenticated Origin Pulls → Global**
on. Enable that last one before the first deploy carrying a proxy — Caddy
requires the client certificate it turns on, and without it every visitor gets a
`525`.

The certificate must name **every** hostname the proxy serves — both of them
today. Caddy serves the one pair from every site block, so a hostname missing
from it fails the handshake rather than falling back to anything. Adding a
hostname later means reissuing that certificate and updating both halves, not
issuing a second one.

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
