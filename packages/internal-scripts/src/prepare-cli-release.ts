import * as core from '@actions/core';
import {
  CLI_TAG_PREFIX,
  cliChangelog,
  cliVersion,
  readCliCliff,
  runCliCliff,
  writeCliVersion,
} from '#shared/cli-release.ts';

const nextTag = (await readCliCliff({ bumpedVersion: true })).trim();
const nextVersion = nextTag.slice(CLI_TAG_PREFIX.length);

// git-cliff answers with the last tag rather than an error when nothing it counts has landed, so
// this is what tells a release cut too early from one with something in it.
if (nextVersion === cliVersion) {
  core.setFailed(
    `Nothing to release: no commit under the CLI since ${CLI_TAG_PREFIX}${cliVersion}.`,
  );
  process.exit(1);
}

await writeCliVersion(nextVersion);

// Regenerated in full from history and tags on every release rather than prepended to, so the file
// is a function of the repo and a re-cut cannot leave a half-written section behind.
await runCliCliff({ tag: nextTag, output: cliChangelog });

core.setOutput('version', nextVersion);
core.setOutput('tag', nextTag);
core.info(`${cliVersion} → ${nextVersion}`);
