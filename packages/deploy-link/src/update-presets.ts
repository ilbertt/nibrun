import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEPLOY_PRESETS } from '#presets.ts';
import { findUpdate, type PresetUpdate, requestRelease } from '#updates/releases.ts';
import { updatePresetSource } from '#updates/source.ts';

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
  const sourceFile = Bun.file(new URL('./presets.ts', import.meta.url));
  await Bun.write(sourceFile, updatePresetSource({ source: await sourceFile.text(), updates }));
}

const body = [
  'Updates the deploy presets to their latest upstream releases.',
  '',
  ...updates.map(
    (update) =>
      `- ${update.slug}: ${update.previous.version} → [${update.next.version}](${update.releaseUrl})`,
  ),
].join('\n');

if (process.env.GITHUB_OUTPUT && !process.argv.includes('--check')) {
  const bodyPath = join(process.env.RUNNER_TEMP ?? '/tmp', 'deploy-preset-updates.md');
  await Bun.write(bodyPath, `${body}\n`);
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `body-path=${bodyPath}\nhas-errors=${failures.length > 0}\n`,
  );
} else {
  process.exitCode = failures.length > 0 ? 1 : 0;
}

console.info(`${updates.length} updates, ${failures.length} failures`);
