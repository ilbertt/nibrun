# infra

One AWS stack: the control plane runs Compose, app hosts and the nibrunner host run tenant
microVMs, and the port relay forwards non-HTTP tenant traffic. `deploy/` is shell rather than
TypeScript because those scripts run *on* a box and an instance has no Bun; everything CI runs
lives in `@repo/internal-scripts`.

The Terraform explains itself — read it rather than a description of it here.

The isolated nibrunner host uses an outbound Cloudflare Tunnel and has no security-group
ingress rules. Its HTTP proxy listens on `127.0.0.1:8080`; `cloudflared` preserves the requested
hostname so nibrunner can route each app. Public instance addresses support outbound traffic
only. The separate legacy app-host fleet still uses its existing origin proxy and port relay.

Terraform creates proxied CNAME records for `nibrunner_domain` and its wildcard, both pointing
to the Tunnel. CI supplies the domain through `NIBRUNNER_ORIGIN_DOMAIN`. The Terraform token
needs Zone Read and DNS Edit on this zone as well as Cloudflare Tunnel Edit.

For custom domains in the nibrunner zone, Terraform creates `fallback.<nibrunner_domain>` as
a proxied Tunnel CNAME and registers it as the Cloudflare for SaaS fallback origin. It manages
Full (strict) SSL and disables Authenticated Origin Pulls on that zone. The Terraform token
also needs Zone Settings Edit and SSL and Certificates Edit there.

The Tunnel forwards every hostname to nibrunner's loopback HTTP proxy, preserving the Host
header. Nibrunner serves only hostnames in its desired state. A custom-domain SSL exception
rule is unnecessary because the local origin uses HTTP inside the encrypted Tunnel.

Cloudflare for SaaS activation and its billing setup are account prerequisites, completed in
the dashboard before applying. Terraform does not create customer-owned hostnames. Those must
be registered in the nibrunner zone by the application; the shared production API currently
uses the separate legacy app-host zone, whose custom-domain configuration remains separate.

The host fetches its Tunnel token directly from SSM. systemd passes it through `LoadCredential`
to an unprivileged `cloudflared` process; CI and RunCommand receive only the parameter name.
The signed Cloudflare APT repository supplies stable `cloudflared` updates on every deploy.
The host installs `apt.conf` before any package operations so APT waits up to five minutes for
the dpkg lock when unattended upgrades are running.

Config carries its component's prefix (`API_`, `POSTGRES_`, `PG_BACKUP_`, `CADDY_`, `DOZZLE_`,
`VICTORIALOGS_`, `PGWEB_`, `UMAMI_`, `CLOUDFLARED_`) unless more than one component reads it, and keeps one name from
the Terraform output through the SSM command to the `.env` the box writes. Nothing is aliased in
transit, so nothing can drift.

## First run

AWS account bootstrap and the app-host DNS settings below are manual. Terraform provisions
both Tunnels and their DNS records.

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

- Terraform manages the four control-plane hostnames as CNAMEs to the control-plane Tunnel.
- `*.<app_domain>` A → `app_host_public_ips`. One record covers the whole fleet, so there is
  nothing per app in DNS.

App-host origins use A records only. Cloudflare serves visitors over IPv6 from its own edge;
the Tunnel needs no public origin address. App-host addresses outlive a replacement.

Then, **in the legacy app-host zone**: SSL/TLS **Full (strict)** and **Authenticated Origin Pulls → Global** on.
Turn AOP on *before* the first deploy carrying a proxy — Caddy requires its client certificate,
and without it every visitor gets a `525`. Terraform issues an ECC origin
certificate and key for legacy app hosts, covering the domain and wildcard, into
the existing SSM parameters. The key remains in encrypted Terraform state like the existing
SSM-managed secrets. Certificate rotation requires deploying a second certificate before
revoking the first; `prevent_destroy` blocks revocation during an ordinary apply.

The control plane and nibrunner use Tunnels and need no origin certificates or Authenticated
Origin Pulls. The control plane publishes only its VPC control and log-ingest listeners.

Sign-in needs a GitHub OAuth App whose callback URL is
`https://<api_hostname>/api/auth/callback/github`.

Umami uses the `UMAMI_HOSTNAME` repository variable (`umami.nibrun.com` for this deployment).
Its admin credentials are seeded before the public proxy starts.

For Umami's region and city data, enable **Rules → Settings → Managed Transforms → Add visitor
location headers** in the control-plane zone. Caddy forwards Cloudflare's headers to Umami, which
uses `CF-Connecting-IP` for the visitor IP. See [Umami's guide](https://docs.umami.is/docs/enable-cloudflare-headers).

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
- The apex redirects to the marketing site from the app-host proxy, and reaching it takes two
  things here: `<app_domain>` A → `app_host_public_ips`, **proxied**, since the bare name has no
  record of its own. Terraform's origin certificate includes both `<app_domain>` and
  `*.<app_domain>` because a wildcard does not cover the bare name.

Terraform looks up the existing `app_host_domain` zone and provisions the API's account-owned
token with *Zone → SSL and Certificates → Edit* on that zone only. The token goes to SSM and
the zone ID to the existing deploy output; the zone and its manually configured settings are
not managed by Terraform.

Registering a custom hostname cannot be manual — a brought
domain arrives whenever an owner adds one — which is what the token is for.

## Deploying

`.github/workflows/cd.yml`, on every push to main. No SSH and no key material in CI: the last leg
triggers `on_box_deploy.sh` over SSM RunCommand.

**No secret may pass through the workflow's own environment.** RunCommand keeps its parameters in
command history, in the clear, for 30 days — so Terraform writes secrets into SSM parameters the
instance decrypts with its own role. Both GHCR packages must be public for the same reason: the box
pulls with no registry credentials.

`workflow_dispatch` takes `allow_destroy` for the times a plan legitimately replaces something.

Compose pulls service images on each deploy. Keep compatible moving tags such as
`caddy:2.11-alpine`, `postgres:18-alpine` and `alpine:3.24` where upstream publishes them;
an exact patch tag requires an explicit bump to receive the next patch release. Image builds
use `--pull` to refresh their base images. Guest-image and runtime toolchain digests remain
pinned separately because they are inputs to reproducible artifacts.

Control-plane deploys prune unused Docker images, including tagged releases, before pulling
and again after the health gate and Caddy reload. Images created within the last 24 hours stay
cached for rollbacks; every image referenced by a container is preserved regardless of age.
Cleanup never prunes volumes or removes persistent data.
