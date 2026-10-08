import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { DEPLOY_PRESETS } from '#presets.ts';
import { presetUpdateProposal } from '#scripts/updates/proposal.ts';
import { findUpdate, type PresetUpdate, requestRelease } from '#scripts/updates/releases.ts';
import { updatePresetSource } from '#scripts/updates/source.ts';

const updates: PresetUpdate[] = [];
const failures: string[] = [];

for (const [slug, preset] of Object.entries(DEPLOY_PRESETS)) {
  try {
    const update = await findUpdate({ slug, preset, request: requestRelease });
    if (update) {
      updates.push(update);
      console.info(`${slug}: ${update.previous.version} → ${update.next.version}`);
    }
  } catch (error) {
    const failure = `${slug}: ${error instanceof Error ? error.message : String(error)}`;
    failures.push(failure);
    console.error(failure);
  }
}

if (!process.argv.includes('--check') && updates.length > 0) {
  const sourceFile = Bun.file(new URL('../src/presets.ts', import.meta.url));
  await Bun.write(sourceFile, updatePresetSource({ source: await sourceFile.text(), updates }));
}

if (process.env.GITHUB_OUTPUT && !process.argv.includes('--check')) {
  const { branch, body } = presetUpdateProposal(updates);
  const delimiter = randomUUID();
  await appendFile(
    process.env.GITHUB_OUTPUT,
    [
      `has-updates=${updates.length > 0}`,
      `has-errors=${failures.length > 0}`,
      `branch=${branch}`,
      `body<<${delimiter}`,
      body,
      delimiter,
      '',
    ].join('\n'),
  );
} else {
  process.exitCode = failures.length > 0 ? 1 : 0;
}

console.info(`${updates.length} updates, ${failures.length} failures`);
