import * as core from '@actions/core';
import { $ } from 'bun';
import { writeSummary } from '#shared/actions.ts';
import { optionalEnv } from '#shared/env.ts';
import { repoRoot } from '#shared/paths.ts';
import { failOnUnexpectedDestroys, terraform } from '#shared/terraform.ts';

const PLAN_FILE = 'tfplan';
// A plan is worth reading in full, but the step summary caps out well below it.
const SUMMARY_LIMIT = 60_000;

// This job is a required check, so it runs on every pull request and decides
// here whether there is anything to plan — a check gated by a path filter never
// reports, and a PR waiting on it can never merge.
const baseRef = optionalEnv('GITHUB_BASE_REF');
if (baseRef) {
  const changed = await $`git diff --quiet origin/${baseRef}...HEAD -- infra/terraform`
    .cwd(repoRoot)
    .nothrow();
  if (changed.exitCode === 0) {
    core.info('No changes under infra/terraform; nothing to plan.');
    process.exit(0);
  }
}

await terraform(['init', '-input=false']);

// -lock=false keeps this read-only: the plan role has no write access to the
// state bucket, and a pull request has no business holding the state lock.
const plan = await terraform(['plan', '-input=false', '-lock=false', '-out', PLAN_FILE]).nothrow();

if (plan.exitCode !== 0) {
  core.setFailed('terraform plan failed.');
  process.exit(1);
}

const rendered = (await terraform(['show', '-no-color', PLAN_FILE]).quiet().text()).trim();
const truncated =
  rendered.length > SUMMARY_LIMIT
    ? `${rendered.slice(0, SUMMARY_LIMIT)}\n… truncated, see the job log for the rest.`
    : rendered;

await writeSummary(['## Terraform plan', '', '```terraform', truncated, '```'].join('\n'));

const destroyed = await failOnUnexpectedDestroys(PLAN_FILE);
if (destroyed.length > 0) {
  core.info(`Allowlisted destroys/replacements: ${destroyed.join(' ')}`);
}
