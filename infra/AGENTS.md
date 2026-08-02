# infra

AWS, one stack, one box. `bootstrap/` is one-time CloudFormation, `terraform/`
owns the resources, `pg-backup/` is the nightly dump sidecar, `caddy/` is the
proxy's static config. `deploy/` holds only the two scripts that run *on* the
box, which is why they are shell — the instance has no Bun. Everything CI runs
lives in `@repo/internal-scripts`. The EC2 instance runs the compose stack — api and Postgres — behind an
elastic IP, with a persistent EBS volume at `/data` and three S3 buckets:
artifacts for user uploads, backups for Postgres dumps, deploy for runtime
bundles. MinIO stands in for S3 locally only — `docker-compose.prod.yml` parks
it on an inactive profile and points the api at the real bucket.

Caddy terminates TLS on 443 and is the whole public surface; the api stays on
loopback and on the compose network, which is the path fleet-host agents take
later. Compute hosts and the CDN still come later.

Config carries its component's prefix — `API_`, `POSTGRES_`, `PG_BACKUP_`,
`CADDY_` — and keeps one name from the Terraform output through the SSM command
to the `.env` the box writes. Nothing is aliased in transit, so nothing can
drift.

## First run

The domain is not bought yet, so `api_hostname` has no default — pass it at
apply time.

```sh
# Console → CloudFormation → upload bootstrap/github-oidc-bootstrap.yaml, once.
cd infra/terraform
terraform init
terraform apply -var api_hostname=… \
  -var api_github_client_id=… -var api_github_client_secret=… \
  -var caddy_tls_cert=… -var caddy_tls_key=…
```

Then point an A record at `terraform output public_ip`, **proxied** (orange
cloud).

Sign-in needs a GitHub OAuth App whose callback URL is
`https://<api_hostname>/api/auth/callback/github`.

Three zone settings, none of them in code: SSL/TLS **Full (strict)**; an
**Origin Certificate** (ECC — Cloudflare's edge is its only client) whose halves
become `caddy_tls_cert` and `caddy_tls_key`; and **Authenticated Origin Pulls →
Global** on. Enable that last one before the first deploy carrying a proxy —
Caddy requires the client certificate it turns on, and without it every visitor
gets a `525`.

Those five values are the only credentials that enter from outside — everything
else Terraform generates itself.

## Deploying

`.github/workflows/cd.yml`, on every push to main: build both images, apply
Terraform, upload a bundle to S3, then trigger `on_box_deploy.sh` over SSM
RunCommand — no SSH, no key material in CI. Secrets are never passed through:
Terraform generates them into `/nibrun/…` and the instance reads them with its
own role. Terraform runs under the admin bootstrap role; everything after it
drops to the scoped deploy role.

Five repository variables: `AWS_TERRAFORM_APPLY_ROLE_ARN` and
`AWS_TERRAFORM_PLAN_ROLE_ARN`, both bootstrap stack outputs, `API_HOSTNAME`,
`API_GITHUB_CLIENT_ID`, and `CADDY_TLS_CERT`. Two repository secrets,
`API_GITHUB_CLIENT_SECRET` and `CADDY_TLS_KEY` — a certificate is public, its
key is not. Terraform reads each into an SSM parameter the instance decrypts for
itself, so none reaches the deploy's own environment — RunCommand keeps its
parameters in command history, in the clear, for 30 days.
Both GHCR packages must be public — the box pulls with no registry credentials.

`workflow_dispatch` takes `allow_destroy` for the times a plan legitimately
replaces something.
