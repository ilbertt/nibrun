import type { DeployLink } from '@repo/deploy-link';
import { interpolableRuntimeValue, RUNTIME_VALUES } from '@repo/protocol';

export const DEPLOY_PRESETS = {
  boop: {
    name: 'boop',
    port: 8080,
    env: [
      `BOOP_PORT=${interpolableRuntimeValue(RUNTIME_VALUES.HTTP_PORT.name)}`,
      `BOOP_DATABASE_PATH=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}/boop.db`,
      `BOOP_BASE_URL=https://${interpolableRuntimeValue(RUNTIME_VALUES.HOSTNAME.name)}`,
      // Carried without values: the pair is what stands between the admin api and everyone who
      // reaches the url, and a link is read by more people than the one who follows it.
      'BOOP_ADMIN_USER',
      'BOOP_ADMIN_PASSWORD',
    ],
    minimal: true,
  },
  pocketbase: {
    name: 'pocketbase',
    binary:
      'https://github.com/pocketbase/pocketbase/releases/download/v0.40.1/pocketbase_0.40.1_linux_amd64.zip',
    sha256: '0f3442d2e57b03b56fbff0d09289e4a30b4f561a44338c38d2dcd4a1a0cfa91e',
    port: 8090,
    arg: ['serve', '--http=0.0.0.0:8090', '--dir=./data/pb_data'],
    minimal: true,
  },
  sharkord: {
    name: 'sharkord',
    binary: 'https://github.com/sharkord/sharkord/releases/download/v0.0.24/sharkord-linux-x64',
    sha256: '92c5036ddf1951e14fe8359e03a3a66df9e20cee543837621ad47eccb3090d47',
    port: 4991,
    'extra-public-port': true,
    env: [
      'SHARKORD_DATA_PATH=data',
      'SHARKORD_AUTOUPDATE=false',
      `SHARKORD_WEBRTC_PORT=${interpolableRuntimeValue(RUNTIME_VALUES.EXTRA_PUBLIC_PORT.name)}`,
      `SHARKORD_WEBRTC_ANNOUNCED_ADDRESS=${interpolableRuntimeValue(RUNTIME_VALUES.PUBLIC_IPV4.name)}`,
    ],
    minimal: true,
  },
} satisfies Record<string, DeployLink>;

export type DeploySlug = keyof typeof DEPLOY_PRESETS;

export function findPreset(slug: string): DeployLink | undefined {
  return Object.hasOwn(DEPLOY_PRESETS, slug) ? DEPLOY_PRESETS[slug as DeploySlug] : undefined;
}
