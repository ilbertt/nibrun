import { createHash } from 'node:crypto';
import type { PresetUpdate } from '#updates/releases.ts';

export function presetUpdateProposal(updates: PresetUpdate[]): { branch: string; body: string } {
  const targets = updates
    .map((update) => JSON.stringify({ slug: update.slug, next: update.next }))
    .sort()
    .join('\n');
  const identity = createHash('sha256').update(targets).digest('hex');
  return {
    branch: `codex/update-deploy-presets-${identity}`,
    body: [
      'Updates the deploy presets to their latest upstream releases.',
      '',
      ...updates.map(
        (update) =>
          `- ${update.slug}: ${update.previous.version} → [${update.next.version}](${update.releaseUrl})`,
      ),
    ].join('\n'),
  };
}
