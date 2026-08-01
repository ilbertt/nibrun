import * as core from '@actions/core';
import { $ } from 'bun';
import { writeSummary } from '#shared/actions.ts';
import { optionalEnv } from '#shared/env.ts';
import { terraformDir } from '#shared/paths.ts';

const PLAN_FILE = 'tfplan';

// Consumed by the deploy steps that follow, under these exact names.
const DEPLOY_OUTPUTS = [
  'api_hostname',
  'api_s3_bucket',
  'api_s3_endpoint',
  'pg_backup_bucket',
  'deploy_bucket',
  'data_volume_id',
  'deploy_group',
  'ssm_secret_prefix',
  'github_deploy_role_arn',
];

type ResourceChange = {
  address: string;
  change: { actions: string[] };
};

const inActions = optionalEnv('GITHUB_ACTIONS') === 'true';
// Actions renders ANSI but is not a TTY, so Bun's own detection says no.
const useColor = Bun.enableANSIColors || inActions;

const style = (code: string) => (text: string) =>
  useColor ? `\u001b[${code}m${text}\u001b[0m` : text;
const bold = style('1');
const red = style('31');
const green = style('32');
const cyan = style('36');

async function group<T>({ title, run }: { title: string; run: () => Promise<T> }): Promise<T> {
  if (inActions) {
    core.startGroup(title);
  } else {
    console.log(bold(cyan(`\n▸ ${title}`)));
  }
  try {
    return await run();
  } finally {
    if (inActions) {
      core.endGroup();
    }
  }
}

function terraform(args: string[]) {
  return $`terraform ${args}`.cwd(terraformDir);
}

await group({
  title: 'terraform init',
  run: () => terraform(['init', '-input=false']),
});

await group({
  title: 'terraform plan',
  run: () => terraform(['plan', '-input=false', '-out', PLAN_FILE]),
});

// The data volume holds Postgres and the artifacts bucket holds users' uploaded
// binaries, so an unnoticed replace is unrecoverable.
if (optionalEnv('ALLOW_DESTROY') !== 'true') {
  const plan = await terraform(['show', '-json', PLAN_FILE]).quiet().json();

  const allowed = new Set(
    (optionalEnv('ALLOWED_TERRAFORM_DESTROY_ADDRESSES') ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );

  const destroyed = [
    ...new Set(
      (plan.resource_changes ?? [])
        .filter((change: ResourceChange) => change.change.actions.includes('delete'))
        .map((change: ResourceChange) => change.address),
    ),
  ].sort() as string[];

  const unexpected = destroyed.filter((address) => !allowed.has(address));

  if (unexpected.length > 0) {
    console.log(red(bold('\nThe plan would destroy or replace resources that are not allowed:')));
    for (const address of unexpected) {
      console.log(red(`  - ${address}`));
    }
    await writeSummary(
      [
        '## Destructive terraform plan blocked',
        '',
        ...unexpected.map((address) => `- \`${address}\``),
        '',
        'Rerun via workflow_dispatch with `allow_destroy` enabled if this is intended.',
      ].join('\n'),
    );
    core.setFailed(`Plan destroys/replaces: ${unexpected.join(' ')}`);
    process.exit(1);
  }

  if (destroyed.length > 0) {
    console.log(bold('\nAllowed destroys/replacements:'));
    for (const address of destroyed) {
      console.log(`  - ${address}`);
    }
  }
}

await group({
  title: 'terraform apply',
  run: () => terraform(['apply', '-input=false', PLAN_FILE]),
});

const outputs = (await terraform(['output', '-json']).quiet().json()) as Record<
  string,
  { value: string }
>;

console.log(green(bold('\n✓ applied')));

for (const name of DEPLOY_OUTPUTS) {
  const value = outputs[name]?.value;
  if (value === undefined) {
    core.setFailed(`Missing terraform output: ${name}`);
    process.exit(1);
  }
  core.setOutput(name, value);
  console.log(`  ${name}=${value}`);
}
