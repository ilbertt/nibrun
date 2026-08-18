# infra

AWS, one stack, two machine classes: the control plane runs the compose stack, app hosts run
tenant microVMs. `deploy/` is shell rather than TypeScript because those scripts run *on* a box and
an instance has no Bun; everything CI runs lives in `@repo/internal-scripts`.

The Terraform explains itself — read it rather than a description of it here.

Config carries its component's prefix (`API_`, `POSTGRES_`, `PG_BACKUP_`, `CADDY_`, `DOZZLE_`,
`VICTORIALOGS_`) unless more than one component reads it, and keeps one name from the Terraform
output through the SSM command to the `.env` the box writes. Nothing is aliased in transit, so
nothing can drift.

## First run

All of this is manual and none of it is in code.

```sh
# Console → CloudFormation → upload bootstrap/github-oidc-bootstrap.yaml, once.
# Its StateBucket output is the bucket below, and the TF_STATE_BUCKET
# repository variable CI passes the same way.
cd infra/terraform
terraform init -backend-config=bucket=<StateBucket>
terraform apply # prompts for every variable without a default
```

The backend names no bucket of its own: it is resolved before any provider, so it cannot derive
the account id the way `s3.tf` does, and hardcoding one would both publish the account id and pin
a rebuilt account to names its predecessor still holds for ~90 days.

DNS, every record **proxied** (orange cloud):

- one A record per control-plane hostname (`api_hostname`, `dozzle_hostname`,
  `victorialogs_hostname`) → `terraform output public_ip`
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

Custom domains, in the `app_domain` zone only:

- **Cloudflare for SaaS** on, and `fallback.<app_domain>` A → `app_host_public_ips`, **proxied**,
  set as the zone's **fallback origin**. Nothing serves that name — the site blocks are still
  written per hostname — it exists so the edge has an address to resolve. Traffic for a custom
  hostname reaches the origin naming *the custom hostname* in both the handshake and the request,
  which is what lets Caddy's rendered site blocks match it with nothing added.
- A **Configuration Rule**: where the host is not under `app_domain`, SSL → **Full**. The zone
  stays Full (strict), so platform hostnames are unaffected. This is the one place the posture is
  weakened, and it is deliberate: the origin certificate names `*.<app_domain>` and a brought
  domain is not under it, so strict cannot validate a name no certificate we can issue covers.
  Authenticated Origin Pulls still applies — global AOP covers custom hostnames on a
  Cloudflare-for-SaaS zone — so what is given up is the origin proving itself to the edge, not
  the edge proving itself to the origin, which is the half `security_group.tf` rests on.
- An **API token** scoped to *Zone → SSL and Certificates → Edit* on this zone and nothing else,
  as the `CLOUDFLARE_API_TOKEN` repository secret, with the zone id as `CLOUDFLARE_ZONE_ID`.

Unlike every other Cloudflare step here, registering a hostname cannot be manual — a brought
domain arrives whenever an owner adds one — which is what the token is for.

## Deploying

`.github/workflows/cd.yml`, on every push to main. No SSH and no key material in CI: the last leg
triggers `on_box_deploy.sh` over SSM RunCommand.

**No secret may pass through the workflow's own environment.** RunCommand keeps its parameters in
command history, in the clear, for 30 days — so Terraform writes secrets into SSM parameters the
instance decrypts with its own role. Both GHCR packages must be public for the same reason: the box
pulls with no registry credentials.

`workflow_dispatch` takes `allow_destroy` for the times a plan legitimately replaces something.
