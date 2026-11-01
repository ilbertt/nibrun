import * as core from '@actions/core';

export function requireMainWorkflow() {
  if (Bun.env.GITHUB_ACTIONS !== 'true' || Bun.env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Nibrunner host changes must run through GitHub Actions on main.');
  }
}

// core.summary.write() throws when the env var is missing, which it is
// everywhere except inside a workflow run.
export async function writeSummary(markdown: string) {
  if (!Bun.env.GITHUB_STEP_SUMMARY) {
    return;
  }
  await core.summary.addRaw(markdown, true).write();
}
