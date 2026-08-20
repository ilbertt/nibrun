import * as core from '@actions/core';
import {
  CLI_TAG_PREFIX,
  cliChangelog,
  cliVersion,
  hasUnreleasedChanges,
  nextCliVersion,
  runCliCliff,
  writeCliVersion,
} from '#shared/cli-release.ts';

if (!(await hasUnreleasedChanges())) {
  core.setFailed(
    `Nothing to release: no commit under the CLI since ${CLI_TAG_PREFIX}${cliVersion}.`,
  );
  process.exit(1);
}

const nextVersion = await nextCliVersion();
const nextTag = `${CLI_TAG_PREFIX}${nextVersion}`;

await writeCliVersion(nextVersion);

// Regenerated in full from history and tags on every release rather than prepended to, so the file
// is a function of the repo and a re-cut cannot leave a half-written section behind.
await runCliCliff({ tag: nextTag, output: cliChangelog });

core.setOutput('version', nextVersion);
core.setOutput('tag', nextTag);
core.info(`${cliVersion} → ${nextVersion}`);
