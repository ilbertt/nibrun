import * as core from '@actions/core';
import { runGitCliff } from 'git-cliff';
import {
  CLI_TAG_PREFIX,
  cliChangelog,
  cliCliffOptions,
  cliPackageJson,
  readCliVersion,
} from '#shared/cli-release.ts';
import { repoRoot } from '#shared/paths.ts';

const currentVersion = await readCliVersion();
const nextTag = await bumpedTag();
const nextVersion = nextTag.slice(CLI_TAG_PREFIX.length);

// git-cliff answers with the last tag rather than an error when nothing it counts has landed, so
// this is what tells a release cut too early from one with something in it.
if (nextVersion === currentVersion) {
  core.setFailed(
    `Nothing to release: no commit under the CLI since ${CLI_TAG_PREFIX}${currentVersion}.`,
  );
  process.exit(1);
}

await writeCliVersion(nextVersion);

// Regenerated in full from history and tags on every release rather than prepended to, so the file
// is a function of the repo and a re-cut cannot leave a half-written section behind.
await runGitCliff({ ...cliCliffOptions, tag: nextTag, output: cliChangelog }, { cwd: repoRoot });

core.setOutput('version', nextVersion);
core.setOutput('tag', nextTag);
core.info(`${currentVersion} → ${nextVersion}`);

async function bumpedTag() {
  const { stdout } = await runGitCliff(
    { ...cliCliffOptions, bumpedVersion: true },
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  return String(stdout).trim();
}

async function writeCliVersion(version: string) {
  const pkg = await Bun.file(cliPackageJson).json();
  pkg.version = version;
  await Bun.write(cliPackageJson, `${JSON.stringify(pkg, null, 2)}\n`);
}
