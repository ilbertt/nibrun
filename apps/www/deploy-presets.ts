import type { DeployLink } from '@repo/deploy-link';
import { interpolableRuntimeValue, RUNTIME_VALUES } from '@repo/protocol';

// Update the root README when changing any entry here.
export const DEPLOY_PRESETS = {
  boop: {
    name: 'boop',
    binary:
      'https://github.com/chrisgreg/boop/releases/download/v1.3.0/boop_1.3.0_linux_amd64.tar.gz',
    sha256: 'e68ea6a7dec4bf6f8fe6133735b0b1db4ccb4089d5e6b76e9813a1a63f4797a8',
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
  // Gitea, like Gogs, shells out to git and writes its hooks as bash scripts. This build
  // carries a static git and native hooks inside the binary, which `nibrun` unpacks before
  // serving. It comes up with an administrator whose password is printed to the log.
  gitea: {
    name: 'gitea',
    binary:
      'https://github.com/ilbertt/gitea/releases/download/v1.28.0-dev-nibrun.2/gitea-nibrun-linux-amd64',
    sha256: 'e74bef3081a046c6a3964dee49ca68b94316a69f0709a148ee6234c543a93bb5',
    port: 3000,
    arg: ['nibrun'],
    minimal: true,
  },
  // Gogs shells out to git for every repository operation and the guest carries none, so
  // this build bundles a static one and unpacks it onto the volume. `nibrun` is the
  // subcommand that does that and then serves.
  gogs: {
    name: 'gogs',
    binary:
      'https://github.com/ilbertt/gogs/releases/download/v0.15.0-nibrun.2/gogs-nibrun-linux-amd64',
    sha256: '2ccc30e5f0626239a1814d2b17244bfee366fbb3324025577e8fd77d81fea794',
    port: 3000,
    arg: ['nibrun'],
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
