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
  'context-use': {
    name: 'context-use',
    // The only release is a rolling tag whose asset is replaced on every build, so a checksum
    // written here would refuse the next one. Left out, the download is still held to something:
    // the digest the release publishes for whatever the asset currently is.
    binary:
      'https://github.com/massimoalbarello/context-use/releases/download/nibrun-latest/context-use',
    port: 3000,
    minimal: true,
  },
  gitea: {
    name: 'gitea',
    binary:
      'https://github.com/ilbertt/gitea/releases/download/v1.28.0-dev-nibrun.2/gitea-nibrun-linux-amd64',
    sha256: 'e74bef3081a046c6a3964dee49ca68b94316a69f0709a148ee6234c543a93bb5',
    port: 3000,
    arg: ['nibrun'],
    minimal: true,
  },
  'open-connector': {
    name: 'open-connector',
    binary:
      'https://github.com/oomol-lab/open-connector/releases/download/v1.5.0/open-connector-linux-x64',
    sha256: '127c17d6dcdbd646733ddcb714509996e75cbede1f0eaca6ded9b26fa9115ee2',
    port: 3000,
    env: [
      'HOST=0.0.0.0',
      `OOMOL_CONNECT_DATA_DIR=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}`,
      `OOMOL_CONNECT_ORIGIN=https://${interpolableRuntimeValue(RUNTIME_VALUES.HOSTNAME.name)}`,
      // The catalog held in memory is the largest allocation openconnector makes, and upstream
      // names the 256 MiB machine as the case for reading its schemas off disk instead.
      'OOMOL_CONNECT_CATALOG_LAZY_SCHEMAS=true',
      'OOMOL_CONNECT_ENCRYPTION_KEY',
      'OOMOL_CONNECT_ADMIN_TOKEN',
      'OOMOL_CONNECT_RUNTIME_TOKEN',
    ],
    minimal: true,
  },
  pocketbase: {
    name: 'pocketbase',
    binary:
      'https://github.com/pocketbase/pocketbase/releases/download/v0.40.2/pocketbase_0.40.2_linux_amd64.zip',
    sha256: 'dd86b424a07f2bb5ac2b8ba8cdf013a37400a9cf56bd1f92e560981f7dd24244',
    port: 8090,
    arg: ['serve', '--http=0.0.0.0:8090', '--dir=./data/pb_data'],
    minimal: true,
  },
  sharkord: {
    name: 'sharkord',
    binary: 'https://github.com/sharkord/sharkord/releases/download/v0.0.25/sharkord-linux-x64',
    sha256: 'e381198decf43efe92b1b1e947dc220939a98ae3fb578f4d59b99b80a968fc58',
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
