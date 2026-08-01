import * as core from '@actions/core';

// core.summary.write() throws when the env var is missing, which it is
// everywhere except inside a workflow run.
export async function writeSummary(markdown: string) {
  if (!Bun.env.GITHUB_STEP_SUMMARY) {
    return;
  }
  await core.summary.addRaw(markdown, true).write();
}
