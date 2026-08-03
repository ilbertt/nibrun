# infra

AWS, one stack, two machine classes: the control plane runs the compose stack, app hosts run
tenant microVMs. `deploy/` is shell rather than TypeScript because those scripts run *on* a box and
an instance has no Bun; everything CI runs lives in `@repo/internal-scripts`.

The Terraform explains itself — read it rather than a description of it here.

Config carries its component's prefix (`API_`, `POSTGRES_`, `PG_BACKUP_`, `CADDY_`, `DOZZLE_`)
unless more than one component reads it, and keeps one name from the Terraform output through the
SSM command to the `.env` the box writes. Nothing is aliased in transit, so nothing can drift.

## First run

All of this is manual and none of it is in code.

```sh
# Console → CloudFormation → upload bootstrap/github-oidc-bootstrap.yaml, once.
cd infra/terraform
terraform init
terraform apply # prompts for every variable without a default
```

DNS, every record **proxied** (orange cloud):

- one A record per control-plane hostname (`api_hostname`, `dozzle_hostname`) → `terraform output
  public_ip`
- `*.<app_domain>` A → `app_host_public_ips`. One record covers the whole fleet, so there is
  nothing per app in DNS.

A records only, for both. Cloudflare is the only client either origin has, and it serves
visitors over IPv6 from its own edge — an AAAA here would publish an address nothing needs to
reach. Both addresses outlive a replacement, so the records are written once.

Then, **in both zones**: SSL/TLS **Full (strict)**; an **Origin Certificate** (ECC — Cloudflare's
edge is its only client), whose two halves are a proxy's TLS inputs; and **Authenticated Origin
Pulls → Global** on. Turn that last one on *before* the first deploy carrying a proxy — Caddy
requires the client certificate it enables, and without it every visitor gets a `525`.

Sign-in needs a GitHub OAuth App whose callback URL is
`https://<api_hostname>/api/auth/callback/github`.

## Deploying

`.github/workflows/cd.yml`, on every push to main. No SSH and no key material in CI: the last leg
triggers `on_box_deploy.sh` over SSM RunCommand.

**No secret may pass through the workflow's own environment.** RunCommand keeps its parameters in
command history, in the clear, for 30 days — so Terraform writes secrets into SSM parameters the
instance decrypts with its own role. Both GHCR packages must be public for the same reason: the box
pulls with no registry credentials.

`workflow_dispatch` takes `allow_destroy` for the times a plan legitimately replaces something.
