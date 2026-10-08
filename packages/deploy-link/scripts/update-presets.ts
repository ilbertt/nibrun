import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';
import { DEPLOY_PRESETS } from '#presets.ts';
import { presetUpdateProposal } from '#scripts/updates/proposal.ts';
import { findUpdate, type PresetUpdate, requestRelease } from '#scripts/updates/releases.ts';
import { updatePresetSource } from '#scripts/updates/source.ts';

const updates: PresetUpdate[] = [];
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

for (const [slug, preset] of Object.entries(DEPLOY_PRESETS)) {
  const update = await findUpdate({ slug, preset, request: requestRelease });
  if (update) {
    updates.push(update);
    console.info(`${slug}: ${update.previous.version} → ${update.next.version}`);
  }
}

if (updates.length > 0) {
  const sourceFile = Bun.file(new URL('../src/presets.ts', import.meta.url));
  await Bun.write(sourceFile, updatePresetSource({ source: await sourceFile.text(), updates }));
  await $`bun fix:codestyle`.cwd(repoRoot);
}

if (process.env.GITHUB_OUTPUT) {
  const { branch, body } = presetUpdateProposal(updates);
  const delimiter = randomUUID();
  await appendFile(
    process.env.GITHUB_OUTPUT,
    [
      `has-updates=${updates.length > 0}`,
      `branch=${branch}`,
      `body<<${delimiter}`,
      body,
      delimiter,
      '',
    ].join('\n'),
  );
}

console.info(`${updates.length} updates`);
