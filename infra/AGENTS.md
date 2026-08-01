# infra

AWS, one stack, one box. `bootstrap/` is one-time CloudFormation, `terraform/`
owns the resources, `deploy/` is what CI runs, `pg-backup/` is the nightly dump
sidecar. The EC2 instance runs the compose stack — api and Postgres — behind an
elastic IP, with a persistent EBS volume at `/data` and two S3 buckets:
`artifacts` for user uploads, `deploy` for runtime bundles and Postgres dumps.
Nothing terminates TLS yet. The gateway, compute hosts and the CDN come later.

Everything the api container reads is prefixed `API_`; `POSTGRES_*` is the
database, and the handful of unprefixed keys are box-level.

## First run

The domain is not bought yet, so `hostname` has no default — pass it at apply
time.

```sh
# Console → CloudFormation → upload bootstrap/github-oidc-bootstrap.yaml, once.
cd infra/terraform
terraform init
terraform apply -var hostname=…
```

Then point an A record at `terraform output public_ip`, DNS-only (grey cloud).

## Deploying

CI pushes images, uploads a bundle to S3, and triggers `on_box_deploy.sh` over
SSM RunCommand — no SSH, no key material in CI. Secrets are never passed
through: Terraform generates them into `/nibrun/…` and the instance reads them
with its own role.

Release images must be public — the box pulls with no registry credentials.

The workflows do not exist yet; `enable_github_deploy` already creates the role
they will assume.
