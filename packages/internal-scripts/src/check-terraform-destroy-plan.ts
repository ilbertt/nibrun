import { appendFile } from 'node:fs/promises';
import { $ } from 'bun';
import { optionalEnv } from '#shared/env.ts';
import { terraformDir } from '#shared/paths.ts';

type ResourceChange = {
  address: string;
  change: { actions: string[] };
};

const planFile = Bun.argv[2] ?? 'tfplan';

// `terraform show` needs the initialized working directory to decode the plan.
const plan = await $`terraform show -json ${planFile}`.cwd(terraformDir).json();

const destroyed = [
  ...new Set(
    (plan.resource_changes ?? [])
      .filter((change: ResourceChange) => change.change.actions.includes('delete'))
      .map((change: ResourceChange) => change.address),
  ),
].sort() as string[];

if (destroyed.length === 0) {
  process.exit(0);
}

const allowed = new Set(
  (optionalEnv('ALLOWED_TERRAFORM_DESTROY_ADDRESSES') ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean),
);

const unexpected = destroyed.filter((address) => !allowed.has(address));
const expected = destroyed.filter((address) => allowed.has(address));

async function writeSummary({ title, body }: { title: string; body: string }) {
  const summaryPath = optionalEnv('GITHUB_STEP_SUMMARY');
  if (summaryPath) {
    await appendFile(summaryPath, `## ${title}\n${body}\n`);
  } else {
    console.error(`${title}\n${body}`);
  }
}

const block = (addresses: string[]) => ['```', ...addresses, '```'].join('\n');

if (unexpected.length > 0) {
  let body = `The plan would destroy or replace resources that are not explicitly allowed:\n${block(unexpected)}`;
  if (expected.length > 0) {
    body += `\nThe plan also includes these allowed destroys/replacements:\n${block(expected)}`;
  }
  body +=
    '\nIf intentional, rerun the workflow via workflow_dispatch with `allow_destroy` enabled.';

  await writeSummary({ title: 'Destructive terraform plan blocked', body });
  console.log(
    `::error title=Destructive terraform plan blocked::Plan destroys/replaces: ${unexpected.join(' ')}`,
  );
  process.exit(1);
}

await writeSummary({
  title: 'Allowed terraform destroys',
  body: `The plan only destroys or replaces explicitly allowed resources:\n${block(expected)}`,
});
