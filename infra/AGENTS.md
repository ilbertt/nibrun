# infra

AWS, one stack, one box. `bootstrap/` is one-time CloudFormation, `terraform/`
owns the resources, `pg-backup/` is the nightly dump sidecar. `deploy/` holds
only the two scripts that run *on* the box, which is why they are shell — the
instance has no Bun. Everything CI runs lives in `@repo/internal-scripts`. The EC2 instance runs the compose stack — api and Postgres — behind an
elastic IP, with a persistent EBS volume at `/data` and three S3 buckets:
artifacts for user uploads, backups for Postgres dumps, deploy for runtime
bundles. MinIO stands in for S3 locally only — `docker-compose.prod.yml` parks
it on an inactive profile and points the api at the real bucket.

Nothing terminates TLS yet, and the compose port bindings are loopback-only, so
a deployed box is not publicly reachable. The gateway, compute hosts and the CDN
come later.

Config carries its component's prefix — `API_`, `POSTGRES_`, `PG_BACKUP_` — and
keeps one name from the Terraform output through the SSM command to the `.env`
the box writes. Nothing is aliased in transit, so nothing can drift.

## First run

The domain is not bought yet, so `api_hostname` has no default — pass it at
apply time.

```sh
# Console → CloudFormation → upload bootstrap/github-oidc-bootstrap.yaml, once.
cd infra/terraform
terraform init
terraform apply -var api_hostname=…
```

Then point an A record at `terraform output public_ip`, DNS-only (grey cloud).

## Deploying

`.github/workflows/cd.yml`, on every push to main: build both images, apply
Terraform, upload a bundle to S3, then trigger `on_box_deploy.sh` over SSM
RunCommand — no SSH, no key material in CI. Secrets are never passed through:
Terraform generates them into `/nibrun/…` and the instance reads them with its
own role. Terraform runs under the admin bootstrap role; everything after it
drops to the scoped deploy role.

Three repository variables: `AWS_TERRAFORM_ROLE_ARN` and `AWS_PLAN_ROLE_ARN`,
both bootstrap stack outputs, and `API_HOSTNAME`. Both GHCR packages must be
public — the box pulls with no registry credentials.

`workflow_dispatch` takes `allow_destroy` for the times a plan legitimately
replaces something.
