import { interpolableRuntimeValue, RUNTIME_VALUES } from '@repo/protocol';
import type { DeployLink } from '#link.ts';

/**
 * What a preset is filed under, in the order a catalog should offer them.
 *
 * A closed set rather than free text: a category invented at one entry is a filter that appears
 * once and sorts nothing, and the order the members are written in is a decision about what to
 * show first rather than whatever order the presets happen to be in.
 */
export enum DeployCategory {
  Backends = 'Backends',
  NotesAndKnowledge = 'Notes & knowledge',
  FilesAndSharing = 'Files & sharing',
  Feeds = 'Feeds',
  Communication = 'Communication',
  DeveloperTools = 'Developer tools',
  Analytics = 'Analytics',
  Productivity = 'Productivity',
}

export type DeployPreset = {
  title: string;
  subtitle: string;
  category: DeployCategory;
  deployLink: DeployLink;
};

// Written in the order the root README lists them, which is the order the roller shows. Update
// that table when changing any entry here.
export const DEPLOY_PRESETS = {
  pocketbase: {
    category: DeployCategory.Backends,
    title: 'PocketBase',
    subtitle: 'A database, auth, file storage and an admin UI, in one file.',
    deployLink: {
      name: 'pocketbase',
      binary:
        'https://github.com/pocketbase/pocketbase/releases/download/v0.40.3/pocketbase_0.40.3_linux_amd64.zip',
      sha256: '8d81b6b79add0e219373e922ebe1dddbee7f57fcff602e3585e0d2c654b983ce',
      port: 8090,
      arg: ['serve', '--http=0.0.0.0:8090', '--dir=./data/pb_data', '--publicDir=./data/pb_public'],
      minimal: true,
    },
  },
  sharkord: {
    category: DeployCategory.Communication,
    title: 'Sharkord',
    subtitle: 'A self-hosted chat server with voice, video and screen sharing.',
    deployLink: {
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
  },
  boop: {
    category: DeployCategory.Communication,
    title: 'Boop',
    subtitle: 'A self-hosted notification inbox for your own apps.',
    deployLink: {
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
  },
  gitea: {
    category: DeployCategory.DeveloperTools,
    title: 'Gitea',
    subtitle:
      'A self-hosted Git service with repositories, issues, pull requests, packages and CI.',
    deployLink: {
      name: 'gitea',
      binary:
        'https://github.com/ilbertt/gitea/releases/download/v1.28.0-dev-nibrun.3/gitea-nibrun-linux-amd64',
      sha256: 'f7a3b71523a60be16772b82240a74e4fead1a5e7162008d6e5cf85cdd97ceff6',
      port: 3000,
      arg: ['nibrun'],
      minimal: true,
    },
  },
  'open-connector': {
    category: DeployCategory.DeveloperTools,
    title: 'OpenConnector',
    subtitle: 'One OAuth hub for 1,000+ providers, with prebuilt actions your agents can call.',
    deployLink: {
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
  },
  'context-use': {
    category: DeployCategory.NotesAndKnowledge,
    title: 'Context Use',
    subtitle: 'A personal knowledge base your agents read and write over MCP, behind a passkey.',
    deployLink: {
      name: 'context-use',
      // The only release is a rolling tag whose asset is replaced on every build, so a checksum
      // written here would refuse the next one. Left out, the download is still held to something:
      // the digest the release publishes for whatever the asset currently is.
      binary:
        'https://github.com/massimoalbarello/context-use/releases/download/nibrun-latest/context-use',
      port: 3000,
      minimal: true,
    },
  },
  'nibrun-vitals': {
    category: DeployCategory.Analytics,
    title: 'nibrun-vitals',
    subtitle:
      'The microVM it runs on, as a face you can boop: live CPU, memory, disk, network, visitors and naps.',
    deployLink: {
      name: 'nibrun-vitals',
      binary:
        'https://github.com/ilbertt/nibrun-vitals/releases/download/v2026.9.15-1/vitals-linux-x64',
      sha256: '7dc1910531f9bec63c190abfec06de661348b0885d391982cc333fac312b1f42',
      port: 3000,
      minimal: true,
    },
  },
  picoshare: {
    category: DeployCategory.FilesAndSharing,
    title: 'PicoShare',
    subtitle: 'A minimalist file host: upload a file, share a link, no account needed to download.',
    deployLink: {
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
  },
  memos: {
    category: DeployCategory.NotesAndKnowledge,
    title: 'Memos',
    subtitle: 'A place for short notes, one card to a thought, with tags and search.',
    deployLink: {
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
  },
  shiori: {
    category: DeployCategory.NotesAndKnowledge,
    title: 'Shiori',
    subtitle: 'Bookmarks, each with a readable copy of the page saved beside it.',
    deployLink: {
      name: 'shiori',
      binary:
        'https://github.com/go-shiori/shiori/releases/download/v1.8.0/shiori_Linux_x86_64_1.8.0.tar.gz',
      sha256: '20552c4d91c720dc9786d73a7f5b68abd9ed32addb177861f89ea5d4e5937d3f',
      port: 8080,
      arg: ['serve', '--address', '0.0.0.0', '--port', '8080'],
      env: [`SHIORI_DIR=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}`],
      minimal: true,
    },
  },
  fusion: {
    category: DeployCategory.Feeds,
    title: 'Fusion',
    subtitle: 'An RSS reader for your own feeds, behind a password.',
    deployLink: {
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
  },
  filebrowser: {
    category: DeployCategory.FilesAndSharing,
    title: 'File Browser',
    subtitle: 'A file manager for the volume in a browser: upload, preview, rename, share.',
    deployLink: {
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
  },
  microbin: {
    category: DeployCategory.FilesAndSharing,
    title: 'MicroBin',
    subtitle: 'A pastebin for text, files and links, with expiry and QR codes.',
    deployLink: {
      name: 'microbin',
      binary:
        'https://github.com/szabodanika/microbin/releases/download/v2.1.0/microbin-v2.1.0-x86_64-unknown-linux-musl.tar.gz',
      sha256: '3d6285b4520340c0611875916a7b1dbfa880973541f044c3d18efce799725f45',
      port: 8080,
      env: [
        `MICROBIN_PORT=${interpolableRuntimeValue(RUNTIME_VALUES.HTTP_PORT.name)}`,
        'MICROBIN_BIND=0.0.0.0',
        `MICROBIN_DATA_DIR=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}`,
        // The address it prints into the links it hands out, which is the one the reader followed.
        `MICROBIN_PUBLIC_PATH=https://${interpolableRuntimeValue(RUNTIME_VALUES.HOSTNAME.name)}`,
        'MICROBIN_ADMIN_USERNAME',
        'MICROBIN_ADMIN_PASSWORD',
      ],
      minimal: true,
    },
  },
  goatcounter: {
    category: DeployCategory.Analytics,
    title: 'GoatCounter',
    subtitle: 'Web analytics without cookies, and without following anyone between sites.',
    deployLink: {
      name: 'goatcounter',
      binary:
        'https://github.com/arp242/goatcounter/releases/download/v2.7.0/goatcounter-v2.7.0-linux-amd64.gz',
      sha256: '98d221cb9c8ef2bf76d8daa9cca647839f8d8b0bb5bc7400ff9337c5da834511',
      port: 8080,
      arg: [
        'serve',
        '-listen',
        '0.0.0.0:8080',
        '-db',
        'sqlite+/app/data/goatcounter.sqlite3',
        // TLS is already terminated at the edge, and left to itself it would go and ask for a
        // certificate of its own for a name it cannot answer the challenge on.
        '-tls',
        'none',
        '-automigrate',
      ],
      minimal: true,
    },
  },
  remark42: {
    category: DeployCategory.Communication,
    title: 'Remark42',
    subtitle: 'Comments for a static blog, with no tracking and no third party.',
    deployLink: {
      name: 'remark42',
      binary:
        'https://github.com/umputun/remark42/releases/download/v1.17.1/remark42.linux-amd64.tar.gz',
      sha256: '434e64fc0903d028e8506c4047e99260446d6a51573c8b2dc2492e43558519d4',
      port: 8080,
      arg: ['server'],
      env: [
        `REMARK_URL=https://${interpolableRuntimeValue(RUNTIME_VALUES.HOSTNAME.name)}`,
        'LISTEN=0.0.0.0:8080',
        `STORE_BOLT_PATH=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}`,
        `BACKUP_PATH=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}/backup`,
        // Both default under `./var`, which is the working directory the tenant cannot write: left
        // alone it panics on the first mkdir rather than starting.
        `IMAGE_FS_PATH=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}/pictures`,
        `AVATAR_FS_PATH=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}/avatars`,
        'SECRET',
      ],
      minimal: true,
    },
  },
  traggo: {
    title: 'Traggo',
    subtitle: 'Time tracking where an entry is a set of tags rather than a project.',
    category: DeployCategory.Productivity,
    deployLink: {
      name: 'traggo',
      binary:
        'https://github.com/traggo/server/releases/download/v0.8.3/traggo_0.8.3_linux_amd64.tar.gz',
      sha256: 'c14012c5d4975c23e8214770bba02a106de7fa8fcf1d10c7a127ebec30536639',
      port: 3030,
      env: [
        `TRAGGO_PORT=${interpolableRuntimeValue(RUNTIME_VALUES.HTTP_PORT.name)}`,
        'TRAGGO_DATABASE_DIALECT=sqlite3',
        `TRAGGO_DATABASE_CONNECTION=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}/traggo.db`,
        'TRAGGO_DEFAULT_USER_NAME',
        'TRAGGO_DEFAULT_USER_PASS',
      ],
      minimal: true,
    },
  },
  gotify: {
    title: 'Gotify',
    subtitle: 'A push notification server your own scripts post to, with apps to receive them.',
    category: DeployCategory.Communication,
    deployLink: {
      name: 'gotify',
      binary: 'https://github.com/gotify/server/releases/download/v3.1.1/gotify-linux-amd64.zip',
      sha256: 'd452faad071981d191d5c95f70d0f9520dc2ef2336b2b03055e12cfabfbae2d2',
      port: 8080,
      env: [
        `GOTIFY_SERVER_PORT=${interpolableRuntimeValue(RUNTIME_VALUES.HTTP_PORT.name)}`,
        'GOTIFY_DATABASE_DIALECT=sqlite3',
        `GOTIFY_DATABASE_CONNECTION=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}/gotify.db`,
        `GOTIFY_UPLOADEDIMAGESDIR=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}/images`,
        `GOTIFY_PLUGINSDIR=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}/plugins`,
        'GOTIFY_DEFAULTUSER_PASS',
      ],
      minimal: true,
    },
  },
  flipt: {
    title: 'Flipt',
    subtitle: 'Feature flags with a UI, evaluated over HTTP or gRPC.',
    category: DeployCategory.DeveloperTools,
    deployLink: {
      name: 'flipt',
      binary:
        'https://github.com/flipt-io/flipt/releases/download/v2.13.0/flipt_linux_x86_64.tar.gz',
      sha256: 'c701751a28e0ffa6a5a0135917673becc435fedcb9b563d29a6ee754de019e45',
      port: 8080,
      arg: ['server'],
      env: [
        'FLIPT_SERVER_HOST=0.0.0.0',
        `FLIPT_SERVER_HTTP_PORT=${interpolableRuntimeValue(RUNTIME_VALUES.HTTP_PORT.name)}`,
        // v2 keeps the flags in a git repository it writes under `$HOME`, which is a directory the
        // tenant does not own — so it is given one it does.
        `HOME=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}`,
      ],
      minimal: true,
    },
  },
  'open-sync': {
    title: 'Open Sync',
    subtitle:
      'Your GitHub pull requests, Gmail and Slack threads and Granola meetings, synced to a copy you keep.',
    category: DeployCategory.Productivity,
    deployLink: {
      name: 'open-sync',
      // No checksum, for the reason context-use carries none.
      binary:
        'https://github.com/massimoalbarello/open-sync/releases/download/nibrun-latest/open-sync',
      port: 3000,
      minimal: true,
    },
  },
} satisfies Record<string, DeployPreset>;

export type DeploySlug = keyof typeof DEPLOY_PRESETS;

/** Every preset, in the order they are written above, for anything that offers them all. */
export const DEPLOY_PRESET_SLUGS = Object.keys(DEPLOY_PRESETS) as [DeploySlug, ...DeploySlug[]];

export function findPreset(slug: string): DeployPreset | undefined {
  return Object.hasOwn(DEPLOY_PRESETS, slug) ? DEPLOY_PRESETS[slug as DeploySlug] : undefined;
}
