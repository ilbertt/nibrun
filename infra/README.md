# infra

Everything needed to run nibrun on AWS. Terraform owns the resources; the
scripts under `deploy/` move builds onto them over SSM.

```
infra/
  bootstrap/   one-time CloudFormation: OIDC provider, Terraform role, state bucket
  terraform/   the environment — VPC, control plane, compute hosts, buckets, CDN, secrets
  deploy/      what CI runs: build images, package bundles, drive the on-box deploys
  pg-backup/   sidecar image that streams a nightly pg_dumpall to S3
```

## Shape

Two fleets, because the architecture splits deciding from doing.

**Control plane** — one instance, one compose stack: `apps/api`, `apps/gateway`
and Postgres. Public on 80/443. Holds an elastic IP that both `app.nibrun.com`
and `*.nibrun.app` point at.

**Compute hosts** — `host_count` instances, each running `apps/agent` as a
systemd unit rather than a container: the agent is what creates isolation, so it
needs the host's cgroups, `/dev/kvm` and network. Their security group has **no
ingress from the internet at all** — the agent dials out and work arrives down
that socket. The single exception is the gateway reaching guest ports
(`guest_port_min`–`guest_port_max`), allowed by security-group reference so a
guest is unreachable even if a host picks up a public IP.

`apps/dashboard` is embedded in the api binary and needs no infrastructure of
its own. `apps/www` is static and goes to S3 + CloudFront (`enable_www_cdn`).

Persistent state never lives on a root volume, which AWS deletes on
termination. The control plane gets one EBS volume at `/data` (Postgres, the
gateway's certificate store); each host gets its own at `/var/lib/nibrun`
(the per-app directories mounted into guests at `data/`). All of them carry a
`Backup` tag and are snapshotted daily by DLM, and all are `prevent_destroy`.

## First run

1. **Bootstrap**, once per AWS account, in the console: CloudFormation → Create
   stack → upload `bootstrap/github-oidc-bootstrap.yaml`. It creates the state
   bucket, the GitHub OIDC provider and the `nibrun-terraform` role. Set
   `CreateOidcProvider=false` if the account already has the provider.
   Put the role ARN in the repo as the `AWS_TERRAFORM_ROLE_ARN` variable.

2. **Apply**:

   ```sh
   cd infra/terraform
   terraform init -backend-config=backends/dev.conf
   terraform apply -var-file=dev.tfvars
   ```

3. **DNS**. Not managed here — the registrar may not be Route 53 — so
   `terraform output dns_records` prints what to create. Keep them DNS-only /
   unproxied (grey cloud on Cloudflare): the gateway terminates TLS itself, and
   a proxy in front of it will break the ACME challenge.

4. **Deploy** (see below). Control plane first, then the hosts.

`enable_www_cdn` starts off. Turn it on once the www hostnames resolve to you:
the first apply then blocks on ACM validation until you add the CNAMEs from
`terraform output acm_validation_records`.

## Deploying

CI builds and pushes the images, packages a bundle to S3, and triggers the
on-box script over SSM RunCommand. No SSH anywhere — instances have no inbound
port for it and CI holds no key material. Shell access, when you need it, is
SSM Session Manager.

```
                 ┌── build_and_push_image.sh ──→ ghcr.io
CI (GitHub) ─────┼── package_*_bundle.sh ──────→ s3://nibrun-deploy-…
                 └── ssm_deploy_*.sh ───────────→ SSM ──→ on_*_deploy.sh on the box
```

| Script | Runs | Does |
| --- | --- | --- |
| `build_and_push_image.sh` | CI | buildx build + push one image |
| `verify_public_images.sh` | CI | fails if a release image is not anonymously pullable |
| `package_control_plane_bundle.sh` | CI | tars the compose files + on-box scripts |
| `package_agent_bundle.sh` | CI | tars the compiled agent binary + unit + on-host scripts |
| `ssm_deploy_control_plane.sh` | CI | drives the control-plane rollout |
| `ssm_deploy_hosts.sh` | CI | drives the agent rollout across every host |
| `ssm_run.sh` | CI | shared: target by tag, wait for SSM, send, poll, stream output |
| `publish_www.sh` | CI | syncs the static build to the CDN origin and invalidates |
| `on_control_plane_deploy.sh` | control plane | renders `.env` from SSM, `compose up`, health gate |
| `on_host_deploy.sh` | each host | installs the binary + unit, restarts, waits for it to settle |
| `ensure_data_volume.sh` | both | mounts the persistent volume, creates its directories |
| `check_terraform_destroy_plan.sh` | CI | blocks a plan that would destroy anything unexpected |

The control-plane box pulls images with no registry credentials, so the release
packages must be public — that is what `verify_public_images.sh` guards.

**Order.** Control plane before hosts. Both fleets read the same
`host_token` from SSM, so if it has been rotated, a host deployed first will
present a token the api does not yet accept.

Secrets are never passed through CI. Terraform generates them into SSM Parameter
Store (`/nibrun/<env>/…`), and each instance reads what it needs with its own
instance role:

| Parameter | Used by |
| --- | --- |
| `db_password` | control plane — Postgres, and the api's `DATABASE_URL` |
| `better_auth_secret` | control plane — session signing |
| `host_token` | both — what the agent presents when it dials the socket |

## Assumptions

Things this scaffolding expects but does not itself provide:

- **`docker-compose.yml` and `docker-compose.prod.yml` at the repo root.**
  `on_control_plane_deploy.sh` runs `docker compose -f docker-compose.yml -f
  docker-compose.prod.yml`, and `package_control_plane_bundle.sh` refuses to
  build a bundle without both. The prod override is expected to define services
  named `postgres`, `api`, `gateway` and `pg-backup`; to bind the data-bearing
  volumes to `/data/volumes/…`; and to read the variables
  `on_control_plane_deploy.sh` writes into `.env` (image URIs, `DATABASE_URL`,
  `BETTER_AUTH_SECRET`, `NIBRUN_HOST_TOKEN`, `S3_BUCKET`, `BACKUP_BUCKET`,
  `API_HOSTNAME`, `APPS_DOMAIN`, `ACME_EMAIL`).

- **The api resolves AWS credentials from the default chain.** In production
  there are no static S3 keys: the instance role is picked up over IMDS, which
  is why the instances allow two metadata hops. `apps/api/.env.example` still
  lists `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` for MinIO locally, and the
  rendered prod `.env` deliberately omits them along with `S3_ENDPOINT`.

- **The gateway obtains certificates for `*.nibrun.app` itself.** Its Caddyfile
  lives in `apps/gateway` and is baked into the image, so there is no config to
  bind-mount and nothing to hot-reload after a deploy. Infra only opens 80/443
  and supplies `ACME_EMAIL` and `APPS_DOMAIN`. A wildcard certificate would need
  a DNS-01 challenge and provider credentials; on-demand TLS with an `ask`
  endpoint pointed at the api avoids both.

- **`c7i.large` hosts run the process and container runners only.** The
  Firecracker runner needs nested virtualisation, which on AWS means a
  bare-metal instance type.

- **The agent binary is built for `linux/amd64`.** `package_agent_bundle.sh`
  warns if it is handed a macOS build, which would install fine and then fail to
  exec.

GitHub Actions workflows are not here yet — the `deploy/` scripts are written to
be driven by them, and `enable_github_deploy` already creates the scoped role
they will assume (`terraform output github_deploy_role_arn` →
`AWS_DEPLOY_ROLE_ARN`).

## Notes

- `.terraform.lock.hcl` is not committed: it is generated by `terraform init`.
  Commit it from the first run so CI resolves the same provider versions.
- `lifecycle { ignore_changes = [ami] }` on both instance types means a new
  Amazon Linux release does not silently replace a running box. Bump
  deliberately.
- `check_terraform_destroy_plan.sh` exists because the data volumes and the
  artifacts bucket hold customer data. Allow a destroy explicitly through
  `ALLOWED_TERRAFORM_DESTROY_ADDRESSES` rather than loosening the check.
