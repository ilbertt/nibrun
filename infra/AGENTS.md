# infra

AWS. `bootstrap/` is one-time CloudFormation, `terraform/` owns the resources,
`deploy/` is what CI runs, `pg-backup/` is the nightly dump sidecar.

## Shape

Two fleets. **Control plane** — one box, one compose stack: api + gateway +
Postgres 18, public on 80/443, holding the elastic IP that both `api_hostname`
and the customer-app wildcard point at. **Compute hosts** — `host_count` boxes
running the agent as a systemd unit, with no internet ingress at all, since the
agent dials out. The one exception is the gateway reaching guest ports, allowed
by security-group reference so guests stay unreachable even if a host gets a
public IP.

The domains are not bought yet, so `api_hostname`, `apps_domain` and
`acme_email` have no defaults and `dev.tfvars` does not set them — pass them at
apply time. `apps_domain` must be a different registrable domain from
`api_hostname`, or customer JS lands in the dashboard's cookie scope.

Persistent state never sits on a root volume, which AWS deletes on termination:
the control plane has an EBS volume at `/data`, each host one at
`/var/lib/nibrun`. All are `prevent_destroy` and snapshotted daily.

## First run

```sh
# 1. Console → CloudFormation → upload bootstrap/github-oidc-bootstrap.yaml
# 2.
cd infra/terraform
terraform init -backend-config=backends/dev.conf
terraform apply -var-file=dev.tfvars
# 3. terraform output dns_records → create them, DNS-only (grey cloud):
#    a proxy in front of the gateway breaks the ACME challenge.
# 4. deploy — control plane, then hosts
```

`enable_www_cdn` starts off; turning it on blocks the apply on ACM validation
until you add `terraform output acm_validation_records`.

## Deploying

CI pushes images, uploads a bundle to S3, and triggers the on-box script over
SSM RunCommand — no SSH, no key material in CI. Secrets are never passed
through: Terraform generates them into `/nibrun/<env>/…` and each instance reads
what it needs with its own role.

Control plane before hosts. Both read the same `host_token`, so a host deployed
first would present one the api does not yet accept.

Release images must be public — the box pulls with no registry credentials.

## Assumptions

- **`docker-compose.yml` + `docker-compose.prod.yml` exist at the repo root.**
  The prod override defines `postgres`, `api`, `gateway`, `pg-backup`, binds the
  data-bearing volumes under `/data/volumes/`, and reads what
  `on_control_plane_deploy.sh` writes into `.env`.
- **The api resolves AWS credentials from the default chain.** No static S3 keys
  in prod; the instance role comes over IMDS, hence two metadata hops. The keys
  in `apps/api/.env.example` are for MinIO locally.
- **The gateway gets its own certificates.** Its Caddyfile is baked into the
  image, so infra only opens 80/443 and passes `ACME_EMAIL` / `APPS_DOMAIN`.
- **`c7i.large` runs the process and container runners.** Firecracker needs
  nested virtualisation — bare metal on AWS.
- **The agent binary is `linux/amd64`.**

GitHub Actions workflows are not here yet; `enable_github_deploy` already
creates the role they will assume.

## Notes

- Commit `.terraform.lock.hcl` from your first `init` — it is not ignored.
- `ignore_changes = [ami]` on both fleets: bump AMIs deliberately.
- Allow a destroy through `ALLOWED_TERRAFORM_DESTROY_ADDRESSES` rather than
  loosening `check_terraform_destroy_plan.sh` — the data volumes and the
  artifacts bucket hold customer data.
