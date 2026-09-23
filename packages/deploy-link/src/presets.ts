import { interpolableRuntimeValue, RUNTIME_VALUES } from '@repo/protocol';
import type { DeployLink } from '#link.ts';

// Written in the order the root README lists them, which is the order the roller shows. Update
// that table when changing any entry here.
export const DEPLOY_PRESETS = {
  pocketbase: {
    name: 'pocketbase',
    binary:
      'https://github.com/pocketbase/pocketbase/releases/download/v0.40.3/pocketbase_0.40.3_linux_amd64.zip',
    sha256: '8d81b6b79add0e219373e922ebe1dddbee7f57fcff602e3585e0d2c654b983ce',
    port: 8090,
    arg: ['serve', '--http=0.0.0.0:8090', '--dir=./data/pb_data', '--publicDir=./data/pb_public'],
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
  gitea: {
    name: 'gitea',
    binary:
      'https://github.com/ilbertt/gitea/releases/download/v1.28.0-dev-nibrun.3/gitea-nibrun-linux-amd64',
    sha256: 'f7a3b71523a60be16772b82240a74e4fead1a5e7162008d6e5cf85cdd97ceff6',
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
  'nibrun-vitals': {
    name: 'nibrun-vitals',
    binary:
      'https://github.com/ilbertt/nibrun-vitals/releases/download/v2026.9.15-1/vitals-linux-x64',
    sha256: '7dc1910531f9bec63c190abfec06de661348b0885d391982cc333fac312b1f42',
    port: 3000,
    minimal: true,
  },
  picoshare: {
    name: 'picoshare',
    binary:
      'https://github.com/mtlynch/picoshare/releases/download/v1.5.4/picoshare-v1.5.4-linux-amd64.tar.gz',
    sha256: '5cd141ac24373b61ed4feaa64850c0de56f88455bc7695b43624ae2fae014431',
    port: 4001,
    arg: ['-db', '/app/data/store.db'],
    env: [
      `PORT=${interpolableRuntimeValue(RUNTIME_VALUES.HTTP_PORT.name)}`,
      'PS_BEHIND_PROXY=true',
      'PS_SHARED_SECRET',
    ],
    minimal: true,
  },
  memos: {
    name: 'memos',
    binary:
      'https://github.com/usememos/memos/releases/download/v0.31.0/memos_0.31.0_linux_amd64.tar.gz',
    sha256: 'd99bf9de5e947cd41f7f1ae59e1e97d9af933d1bcc2d1316b3ab1ffe0a69e5c0',
    port: 5230,
    env: [
      `MEMOS_PORT=${interpolableRuntimeValue(RUNTIME_VALUES.HTTP_PORT.name)}`,
      'MEMOS_ADDR=0.0.0.0',
      `MEMOS_DATA=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}`,
    ],
    minimal: true,
  },
  shiori: {
    name: 'shiori',
    binary:
      'https://github.com/go-shiori/shiori/releases/download/v1.8.0/shiori_Linux_x86_64_1.8.0.tar.gz',
    sha256: '20552c4d91c720dc9786d73a7f5b68abd9ed32addb177861f89ea5d4e5937d3f',
    port: 8080,
    arg: ['serve', '--address', '0.0.0.0', '--port', '8080'],
    env: [`SHIORI_DIR=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}`],
    minimal: true,
  },
  fusion: {
    name: 'fusion',
    binary: 'https://github.com/0x2E/fusion/releases/download/v1.2.1/fusion-linux-amd64',
    sha256: '46bbc00d928eed56432a1a8d7bf75c6715b7fbc07594bc7128cbafee492d3dc6',
    port: 8080,
    env: [
      `FUSION_PORT=${interpolableRuntimeValue(RUNTIME_VALUES.HTTP_PORT.name)}`,
      `FUSION_DB_PATH=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}/fusion.db`,
      // Carried without a value: it is the whole of what stands between the feeds and everyone
      // else who reaches the url.
      'FUSION_PASSWORD',
    ],
    minimal: true,
  },
  filebrowser: {
    name: 'filebrowser',
    binary:
      'https://github.com/filebrowser/filebrowser/releases/download/v2.63.23/linux-amd64-filebrowser.tar.gz',
    sha256: 'b14db2bb8033caa3f80205eb6578b2ed0744ebd9e716b790bc4a9703ce909e88',
    port: 8080,
    // Rooted at the volume rather than the working directory, which is the one place a file put
    // here is still here after a redeploy.
    arg: ['-r', '/app/data', '-d', '/app/data/filebrowser.db', '-a', '0.0.0.0', '-p', '8080'],
    minimal: true,
  },
} satisfies Record<string, DeployLink>;

export type DeploySlug = keyof typeof DEPLOY_PRESETS;

/** Every preset, in the order they are written above, for anything that offers them all. */
export const DEPLOY_PRESET_SLUGS = Object.keys(DEPLOY_PRESETS) as [DeploySlug, ...DeploySlug[]];

export function findPreset(slug: string): DeployLink | undefined {
  return Object.hasOwn(DEPLOY_PRESETS, slug) ? DEPLOY_PRESETS[slug as DeploySlug] : undefined;
}
