import * as core from '@actions/core';
import { optionalEnv } from '#shared/env.ts';
import { failOnUnexpectedDestroys, terraform } from '#shared/terraform.ts';

const PLAN_FILE = 'tfplan';

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

// The one operation a plan cannot express, because nothing in the configuration
// changed: recreating a resource whose state is fine and whose *machine* is not
// — a host to rebuild from scratch, a bootstrap to re-run.
const replaced = (optionalEnv('TERRAFORM_REPLACE') ?? '')
  .split(',')
  .map((address) => address.trim())
  .filter(Boolean);

if (replaced.length > 0) {
  console.log(bold(`\nRecreating: ${replaced.join(' ')}`));
}

await group({
  title: 'terraform plan',
  run: () =>
    terraform([
      'plan',
      '-input=false',
      ...replaced.map((address) => `-replace=${address}`),
      '-out',
      PLAN_FILE,
    ]),
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
  { value: unknown; sensitive: boolean }
>;

// Not every output is a string — the per-host volume map is an object, and the
// step that reads it parses it back — so everything is rendered to a string here
// and the published object is flat.
const render = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

console.log(green(bold('\n✓ applied')));

// Published as one object rather than one Actions output per name: the names
// belong to outputs.tf, and a second list of them here is a list that drifts.
// Terraform already knows which values are secret, so that is what filters them
// rather than an allowlist.
const published: Record<string, string> = {};

for (const [name, output] of Object.entries(outputs)) {
  if (output.sensitive) {
    console.log(`  ${name}=<sensitive, not published>`);
    continue;
  }
  published[name] = render(output.value);
  console.log(`  ${name}=${published[name]}`);
}

core.setOutput('json', JSON.stringify(published));
