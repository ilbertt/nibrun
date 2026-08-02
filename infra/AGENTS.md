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

Caddy is the only container publishing a port off loopback, and the only public
surface: 443, terminating the Cloudflare-to-origin TLS leg for `api_hostname`
and nothing else. The api keeps its own loopback binding and its address on the
compose network, and neither routes through Caddy — the path fleet-host agents
take later must not depend on the public edge. Compute hosts and the CDN still
come later.

TLS is a Cloudflare Origin Certificate, never ACME, so the image is stock Caddy.
Reaching the api means presenting Cloudflare's client certificate: Authenticated
Origin Pulls is on, `caddy/cloudflare-origin-pull-ca.pem` is the public CA it is
checked against, and a direct connection to the origin IP is refused during the
handshake. That is why the security group can stay open to the world rather than
tracking Cloudflare's published ranges.

Config carries its component's prefix — `API_`, `POSTGRES_`, `PG_BACKUP_`,
`CADDY_` — and
keeps one name from the Terraform output through the SSM command to the `.env`
the box writes. Nothing is aliased in transit, so nothing can drift.

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

The zone needs three settings, all by hand, and the third is load-bearing:
SSL/TLS mode **Full (strict)**; an **Origin Certificate** created under SSL/TLS →
Origin Server, whose two halves become `caddy_tls_cert` and `caddy_tls_key` as
issued — ECC, since Cloudflare's edge is the only client that will ever see
them; and **Authenticated Origin Pulls → Global** switched on. Caddy
requires that client certificate, so with the toggle off every visitor gets a
`525` — turn it on before the first deploy that carries a proxy. Global is the
shared Cloudflare certificate, which proves a request came through Cloudflare
but not that it came through *this* zone; the zone-level custom certificate is
the stronger form, at the cost of owning a CA.

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
`API_GITHUB_CLIENT_SECRET` and `CADDY_TLS_KEY`. Certificate and key split across
the two exactly as the OAuth App's halves do — the certificate is handed to
every client that connects, so it is not a secret — and both PEMs are pasted as
Cloudflare issues them, with Terraform doing the base64 the box decodes.
Terraform reads all of them into SSM parameters the instance decrypts for
itself, so none reaches the deploy's own environment — RunCommand keeps its
parameters in command history, in the clear, for 30 days.
Both GHCR packages must be public — the box pulls with no registry credentials,
which is also why no certificate may be baked into an image.

Rotating the origin certificate is a normal deploy: the fingerprint of the cert
rides in Caddy's environment, so compose recreates the container that a changed
bind mount alone would not.

`workflow_dispatch` takes `allow_destroy` for the times a plan legitimately
replaces something.
