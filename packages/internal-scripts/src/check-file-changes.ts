import * as core from '@actions/core';
import { $ } from 'bun';
import { repoRoot } from '#shared/paths.ts';

const paths = Bun.argv.slice(2);
if (paths.length === 0) {
  throw new Error('At least one repository-relative path is required.');
}

const status = await $`git status --porcelain --untracked-files=all -- ${paths}`
  .cwd(repoRoot)
  .text();
const changed = status.trim().length > 0;
core.setOutput('changed', String(changed));
if (changed) {
  const sourceCommit = (await $`git rev-parse HEAD`.cwd(repoRoot).text()).trim();
  core.setOutput('source-commit', sourceCommit);
}
