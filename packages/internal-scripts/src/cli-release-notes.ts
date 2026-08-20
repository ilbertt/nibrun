import * as core from '@actions/core';
import { CLI_TAG_PREFIX, cliVersion, readCliCliff } from '#shared/cli-release.ts';
import { optionalEnv } from '#shared/env.ts';

assertTagMatchesVersion();

const changes = await readCliCliff({ latest: true, strip: 'header' });

const notes = `${changes.trimEnd()}\n${installSection()}${attestationFooter()}`;

// Written where the workflow points rather than printed, because `bun run --filter` labels every
// line of stdout with the package it came from. Without the variable this is a local preview.
const outFile = optionalEnv('RELEASE_NOTES_FILE');
if (outFile) {
  await Bun.write(outFile, notes);
} else {
  console.log(notes);
}

/**
 * A tag is pushed by hand, so it can name a version the package was never bumped to. Nothing
 * downstream would notice — the assets would ship under a number that matches no source — and this
 * is the last step before the release exists, so it is where the two are made to agree.
 */
function assertTagMatchesVersion() {
  const tag = optionalEnv('GITHUB_REF_NAME');
  if (!tag) {
    return;
  }

  const expected = `${CLI_TAG_PREFIX}${cliVersion}`;
  if (tag !== expected) {
    core.setFailed(
      `Tag ${tag} does not match the CLI version on this commit (expected ${expected}).`,
    );
    process.exit(1);
  }
}

/**
 * The script picks the asset, so the assets below are what it fetches rather than what an owner is
 * meant to wire up by hand. It also sidesteps Gatekeeper: these binaries carry no signature macOS
 * accepts, and a browser download would be quarantined where a curl is not.
 */
function installSection() {
  return `
## Install

\`\`\`sh
curl -fsSL https://nibrun.com/install.sh | sh
\`\`\`
`;
}

function attestationFooter() {
  const attestationUrl = optionalEnv('ATTESTATION_URL');
  if (!attestationUrl) {
    return '';
  }

  return `
---

🔒 Every asset here was built and signed on GitHub Actions. Verify the build provenance [here](${attestationUrl}).
`;
}
