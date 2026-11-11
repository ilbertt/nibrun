import * as core from '@actions/core';
import { $ } from 'bun';
import { writeSummary } from '#shared/actions.ts';
import { optionalEnv, requiredEnv } from '#shared/env.ts';
import { terraformDir } from '#shared/paths.ts';

type ResourceChange = {
  address: string;
  change: { actions: string[] };
};

const RETIRED_DASHBOARD_CREDENTIALS = new Set([
  'aws_ssm_parameter.dozzle_password',
  'aws_ssm_parameter.victorialogs_password',
]);

function isRetiredDashboardCredentialDeletion(change: ResourceChange) {
  return (
    RETIRED_DASHBOARD_CREDENTIALS.has(change.address) &&
    change.change.actions.length === 1 &&
    change.change.actions[0] === 'delete'
  );
}

function destroyedResourceAddresses(changes: ResourceChange[]) {
  return [
    ...new Set(
      changes
        .filter((change) => change.change.actions.includes('delete'))
        .map((change) => change.address),
    ),
  ].sort();
}

export function unexpectedTerraformDestroys({
  changes,
  allowed,
}: {
  changes: ResourceChange[];
  allowed: ReadonlySet<string>;
}) {
  return destroyedResourceAddresses(
    changes.filter(
      (change) => !allowed.has(change.address) && !isRetiredDashboardCredentialDeletion(change),
    ),
  );
}

export function terraform(args: string[]) {
  return $`terraform ${args}`.cwd(terraformDir);
}

// The state bucket is the one name nothing can derive: a backend is resolved
// before any provider exists, so aws_caller_identity is out of reach where
// s3.tf uses it. Supplied here rather than written into versions.tf, which
// keeps the account id out of a public repo and lets a rebuild in a fresh
// account claim its own bucket instead of a name its predecessor still holds.
export function terraformInit() {
  return terraform([
    'init',
    '-input=false',
    `-backend-config=bucket=${requiredEnv('TF_STATE_BUCKET')}`,
  ]);
}

// The data volume holds Postgres and the artifacts bucket holds users' uploaded
// binaries, so an unnoticed replace is unrecoverable. Allowlist an address in
// ALLOWED_TERRAFORM_DESTROY_ADDRESSES rather than loosening this.
export async function failOnUnexpectedDestroys(planFile: string) {
  const plan = await terraform(['show', '-json', planFile]).quiet().json();

  const allowed = new Set(
    (optionalEnv('ALLOWED_TERRAFORM_DESTROY_ADDRESSES') ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );

  const changes: ResourceChange[] = plan.resource_changes ?? [];
  const destroyed = destroyedResourceAddresses(changes);
  const unexpected = unexpectedTerraformDestroys({ changes, allowed });

  if (unexpected.length > 0) {
    await writeSummary(
      [
        '## Destructive terraform plan blocked',
        '',
        ...unexpected.map((address) => `- \`${address}\``),
        '',
        'Allowlist these in `ALLOWED_TERRAFORM_DESTROY_ADDRESSES`, or rerun the deploy via workflow_dispatch with `allow_destroy` enabled.',
      ].join('\n'),
    );
    core.setFailed(`Plan destroys/replaces: ${unexpected.join(' ')}`);
    process.exit(1);
  }

  return destroyed;
}
