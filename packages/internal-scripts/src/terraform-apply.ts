import * as core from '@actions/core';
import { optionalEnv } from '#shared/env.ts';
import { failOnUnexpectedDestroys, terraform } from '#shared/terraform.ts';

const PLAN_FILE = 'tfplan';

// Consumed by the deploy steps that follow, under these exact names.
const DEPLOY_OUTPUTS = [
  'api_hostname',
  'api_github_client_id',
  'api_s3_bucket',
  'api_s3_endpoint',
  'pg_backup_bucket',
  'deploy_bucket',
  'data_volume_id',
  'deploy_group',
  'ssm_secret_prefix',
  'github_deploy_role_arn',
];

const inActions = optionalEnv('GITHUB_ACTIONS') === 'true';
// Actions renders ANSI but is not a TTY, so Bun's own detection says no.
const useColor = Bun.enableANSIColors || inActions;

const style = (code: string) => (text: string) =>
  useColor ? `\u001b[${code}m${text}\u001b[0m` : text;
const bold = style('1');
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

await group({
  title: 'terraform init',
  run: () => terraform(['init', '-input=false']),
});

await group({
  title: 'terraform plan',
  run: () => terraform(['plan', '-input=false', '-out', PLAN_FILE]),
});

if (optionalEnv('ALLOW_DESTROY') !== 'true') {
  const destroyed = await failOnUnexpectedDestroys(PLAN_FILE);
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
