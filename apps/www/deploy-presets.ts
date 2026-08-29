import type { DeployLink } from '@repo/deploy-link';

export const DEPLOY_PRESETS = {
  pocketbase: {
    name: 'pocketbase',
    binary:
      'https://github.com/pocketbase/pocketbase/releases/download/v0.40.1/pocketbase_0.40.1_linux_amd64.zip',
    port: 8090,
    arg: ['serve', '--http=0.0.0.0:8090', '--dir=./data/pb_data'],
    minimal: true,
  },
} satisfies Record<string, DeployLink>;

export type DeploySlug = keyof typeof DEPLOY_PRESETS;

export function findPreset(slug: string): DeployLink | undefined {
  return Object.hasOwn(DEPLOY_PRESETS, slug) ? DEPLOY_PRESETS[slug as DeploySlug] : undefined;
}
