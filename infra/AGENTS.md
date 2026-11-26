# infra

One AWS stack: the control plane runs Compose and the nibrunner host runs tenant microVMs.
`deploy/` is shell because those scripts run on a box with no Bun; everything CI runs lives
in `@repo/internal-scripts`.

The filesystem bucket, artifacts, backups and encryption keys survive compute retirement.
Nibrunner uses its own prefix and key in the shared filesystem bucket. Keep the key for existing
archived prefixes so their contents remain recoverable. Published guest artifacts are retained
privately through Terraform's state-removal migration; no deployment reads or writes them.

The Terraform explains itself — read it rather than a description of it here.

The isolated nibrunner host uses an outbound Cloudflare Tunnel and has no security-group
ingress rules. Its HTTP proxy listens on `127.0.0.1:8080`; `cloudflared` preserves the requested
hostname so nibrunner can route each app. Public instance addresses support outbound traffic
only.

Nibrunner requires inactive host SMT and KSM with no retained shared pages. Its EC2 CPU options
use one thread per core; changing these options stops and starts the instance before deployment.

Terraform routes `app_host_domain` and its wildcard through the nibrunner Tunnel and uses the
application apex as the Cloudflare for SaaS fallback origin. The application zone uses Full
(strict) SSL with Authenticated Origin Pulls disabled; those existing zone settings remain
account prerequisites. No separate engine domain is required.

The Tunnel forwards every hostname to nibrunner's loopback HTTP proxy, preserving the Host
header. Nibrunner forwards only app hostnames in its desired state. A custom-domain SSL exception
rule is unnecessary because the local origin uses HTTP inside the encrypted Tunnel.

Direct requests for the application apex receive a temporary redirect to
`https://<www_hostname>`. Terraform supplies both values to `[proxy.http.fallback]`; customer
Host headers continue to select their app.

Cloudflare for SaaS activation and its billing setup are account prerequisites, completed in
the dashboard before applying. Terraform does not create customer-owned hostnames. The API
registers them in the application domain zone.

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

AWS account bootstrap is manual. Terraform provisions
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
- Terraform manages `<app_domain>` and `*.<app_domain>` as CNAMEs to the nibrunner Tunnel.
  A fresh setup creates these records; existing deployments keep their Terraform state so the
  same resources remain managed after the migration imports are removed.

The control plane and nibrunner use Tunnels and need no origin certificates or Authenticated
Origin Pulls. The control plane publishes only its VPC control, log-ingest and metrics-ingest listeners.

Terraform protects the Dozzle, VictoriaLogs and Umami public hostnames with Cloudflare Access,
allowing only members of `cloudflare_account_id` with 24-hour sessions. The account must
already have a Zero Trust organization and the Cloudflare identity provider configured.
`CLOUDFLARE_TERRAFORM_API_TOKEN` needs **Access: Apps and Policies Write** and
**Access: Organizations, Identity Providers, and Groups Read** on that account. Terraform
derives the Tunnel's Access team name from the existing organization's auth domain and each
protected route's accepted audience from its Access application. `cloudflared` rejects requests
without a valid token before forwarding them to Caddy. Production publishes no host ports for
these dashboards; local development keeps the loopback bindings.
Access is the only login for Dozzle and VictoriaLogs. Deployments no longer generate or read
their former password credentials. Terraform deletes the former SSM parameters and password
generators when they are removed from configuration. The API's private log queries and the
fleet's VPC log-ingest listener do not pass through Access.

Sign-in needs a GitHub OAuth App whose callback URL is
`https://<api_hostname>/api/auth/callback/github`.

Umami uses the `UMAMI_HOSTNAME` repository variable (`umami.nibrun.com` for this deployment).
Its admin credentials are seeded before the public proxy starts. Umami keeps its own login
behind Access; it does not authenticate Cloudflare identities. Anonymous browsers load
`/script.js` and `/recorder.js`, fetch `/api/websites/<seeded-website-id>/recorder`, and submit
analytics to `/api/send` and `/api/record`. Replay and heatmap reads require Access. The Tunnel
matches these exact paths before its hostname-wide token validation rule, with path normalization
enabled. All other paths, including `/mcp` and the read API, require Access authentication.

Local MCP clients connect to `https://<UMAMI_HOSTNAME>/mcp` using Access managed OAuth.
Remove any static Umami key or Authorization header from the client and sign in
(`codex mcp login nibrun_umami` for the existing Codex connection). All admitted account
members query analytics with the seeded Umami administrator's visibility through read-only MCP tools.

Terraform generates `UMAMI_MCP_API_KEY` and stores it in SSM. The deploy passes it to the
Umami seed, which registers its SHA-512 hash under a stable key ID. To rotate it, replace
`random_password.umami_mcp_api_key` during the Terraform apply and run the control-plane deploy.
The seed replaces the previous hash in place. A deploy also restores a manually deleted managed key.
Only the audience-validated `/mcp` tunnel route reaches the Caddy socket that supplies this key.

For Umami's region and city data, enable **Rules → Settings → Managed Transforms → Add visitor
location headers** in the control-plane zone. Caddy forwards Cloudflare's headers to Umami, which
uses `CF-Connecting-IP` for the visitor IP. See [Umami's guide](https://docs.umami.is/docs/enable-cloudflare-headers).

Custom domains, in the `app_domain` zone only:

- **Cloudflare for SaaS** on. Terraform sets the zone's **fallback origin** to `<app_domain>`,
  whose CNAME points to the nibrunner Tunnel. The Tunnel preserves the custom hostname in the
  request so nibrunner can route it to the owning app.
- A **Configuration Rule**: where the host is not under `app_domain`, SSL → **Full**. The zone
  stays Full (strict), so platform hostnames are unaffected. This is the one place the posture is
  weakened, and it is deliberate: the origin certificate names `*.<app_domain>` and a brought
  domain is not under it, so strict cannot validate a name no certificate we can issue covers.
  Authenticated Origin Pulls still applies — global AOP covers custom hostnames on a
  Cloudflare-for-SaaS zone — so what is given up is the origin proving itself to the edge, not
  the edge proving itself to the origin, which is the half `security_group.tf` rests on.
- Terraform's apex CNAME routes `<app_domain>` through the nibrunner Tunnel. Nibrunner redirects
  the apex to the marketing site.

Terraform looks up the existing `app_host_domain` zone and provisions the API's account-owned
token with *Zone → SSL and Certificates → Edit* on that zone only. The token goes to SSM and
the zone ID to the existing deploy output; the zone and its manually configured settings are
not managed by Terraform.

Registering a custom hostname cannot be manual — a brought
domain arrives whenever an owner adds one — which is what the token is for.

## Deploying

`.github/workflows/cd.yml`, on every push to main. No SSH and no key material in CI: the last leg
triggers `on_box_deploy.sh` over SSM RunCommand.

Bridge installation prunes obsolete SHA-named builds after its service health gate, under the
deployment lock. It keeps the active build, the two newest other complete builds and every
executable still running. Artifact caches, guest images and tenant data are outside this cleanup.

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

## Metrics

Alloy scrapes nibrunner's loopback endpoint every 30 seconds and writes outbound to Prometheus
on the control plane. Only the nibrunner security group can reach Caddy's metrics listener;
it accepts `POST /api/v1/write` and exposes no query API. Nibrunner retains no inbound rules.
Prometheus has a 512 MiB memory limit and stores up to 30 days or 2 GB of retained blocks on
the persistent data volume; WAL and head chunks need additional disk space.
