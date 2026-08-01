# infra

AWS, one stack — no environments. `bootstrap/` is one-time CloudFormation,
`terraform/` owns the resources, `deploy/` is what CI runs, `pg-backup/` is the
nightly dump sidecar.

## Shape

Two fleets. **Control plane** — one box, one compose stack: api + gateway +
Postgres 18, public on 80/443, holding the elastic IP that both `api_hostname`
and the customer-app wildcard point at. **Compute hosts** — `host_count` boxes
running the agent as a systemd unit, with no internet ingress at all, since the
agent dials out. The one exception is the gateway reaching guest ports, allowed
by security-group reference so guests stay unreachable even if a host gets a
public IP.

Persistent state never sits on a root volume, which AWS deletes on termination:
the control plane has an EBS volume at `/data`, each host one at
`/var/lib/nibrun`. All are `prevent_destroy` and snapshotted daily.

## First run

The domains are not bought yet, so `api_hostname`, `apps_domain` and
`acme_email` have no defaults — pass them at apply time. `apps_domain` must be a
different registrable domain from `api_hostname`, or customer JS lands in the
dashboard's cookie scope.

```sh
# Console → CloudFormation → upload bootstrap/github-oidc-bootstrap.yaml, once.
cd infra/terraform
terraform init
terraform apply -var api_hostname=… -var apps_domain=… -var acme_email=…
```

Then `terraform output dns_records` and create them DNS-only (grey cloud) — a
proxy in front of the gateway breaks the ACME challenge.

## Deploying

CI pushes images, uploads a bundle to S3, and triggers the on-box script over
SSM RunCommand — no SSH, no key material in CI. Secrets are never passed
through: Terraform generates them into `/nibrun/…` and each instance reads what
it needs with its own role.

Control plane before hosts. Both read the same `host_token`, so a host deployed
first would present one the api does not yet accept.

Release images must be public — the box pulls with no registry credentials.

The workflows do not exist yet; `enable_github_deploy` already creates the role
they will assume.
