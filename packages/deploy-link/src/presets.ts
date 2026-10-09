import { interpolableRuntimeValue, RUNTIME_VALUES } from '@repo/protocol/runtime-values';
import type { DeployLink } from '#link.ts';
import boopPage from '../content/boop.md?raw';
import contextUsePage from '../content/context-use.md?raw';
import drizzleGatewayPage from '../content/drizzle-gateway.md?raw';
import filebrowserPage from '../content/filebrowser.md?raw';
import fliptPage from '../content/flipt.md?raw';
import fusionPage from '../content/fusion.md?raw';
import giteaPage from '../content/gitea.md?raw';
import goatcounterPage from '../content/goatcounter.md?raw';
import gotifyPage from '../content/gotify.md?raw';
import memosPage from '../content/memos.md?raw';
import microbinPage from '../content/microbin.md?raw';
import nibrunVitalsPage from '../content/nibrun-vitals.md?raw';
import openConnectorPage from '../content/open-connector.md?raw';
import openSyncPage from '../content/open-sync.md?raw';
import openbaoPage from '../content/openbao.md?raw';
import opencloudPage from '../content/opencloud.md?raw';
import openlistPage from '../content/openlist.md?raw';
import pdfSignerPage from '../content/pdf-signer.md?raw';
import picosharePage from '../content/picoshare.md?raw';
import pocketbasePage from '../content/pocketbase.md?raw';
import remark42Page from '../content/remark42.md?raw';
import sharkordPage from '../content/sharkord.md?raw';
import shioriPage from '../content/shiori.md?raw';
import traggoPage from '../content/traggo.md?raw';
import webdavPage from '../content/webdav.md?raw';
import yarrPage from '../content/yarr.md?raw';

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
  isRecommended: boolean;
  projectUrl: string;
  /** The upstream release the link pins, so anything offering it says what it would deploy. */
  version: string;
  markdownContent: string;
  deployLink: DeployLink;
};

export const DEPLOY_PRESETS = {
  pocketbase: {
    isRecommended: true,
    projectUrl: 'https://github.com/pocketbase/pocketbase',
    version: 'v0.40.4',
    markdownContent: pocketbasePage,
    category: DeployCategory.Backends,
    title: 'PocketBase',
    subtitle: 'A database, auth, file storage and an admin UI, in one file.',
    deployLink: {
      name: 'pocketbase',
      binary:
        'https://github.com/pocketbase/pocketbase/releases/download/v0.40.4/pocketbase_0.40.4_linux_amd64.zip',
      sha256: '9042ec818570e79c3628dadcd0a756c1496d9e1173918ec409d133c02f82e5fa',
      port: 8090,
      arg: ['serve', '--http=0.0.0.0:8090', '--dir=./data/pb_data', '--publicDir=./data/pb_public'],
      minimal: true,
    },
  },
  openbao: {
    isRecommended: false,
    projectUrl: 'https://github.com/openbao/openbao',
    version: 'v2.7.1',
    markdownContent: openbaoPage,
    category: DeployCategory.DeveloperTools,
    title: 'OpenBao',
    subtitle: 'A secrets manager with encrypted storage, access policies and a web UI.',
    deployLink: {
      name: 'openbao',
      binary:
        'https://github.com/openbao/openbao/releases/download/v2.7.1/openbao_2.7.1_linux_amd64.tar.gz',
      sha256: '0e2f1ce10d124e03112b50dd2fbec6b78003783253bc3a91587938f39d1e2243',
      port: 8200,
      arg: ['server', '-config=/app/data/openbao.hcl'],
      env: [
        `HOME=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}`,
        `BAO_API_ADDR=https://${interpolableRuntimeValue(RUNTIME_VALUES.HOSTNAME.name)}`,
        'GOMEMLIMIT=128MiB',
      ],
      // The upstream server needs a configuration file supplied through Initial data.
      minimal: false,
    },
  },
  opencloud: {
    projectUrl: 'https://github.com/opencloud-eu/opencloud',
    version: 'v8.1.0',
    markdownContent: opencloudPage,
    category: DeployCategory.FilesAndSharing,
    title: 'OpenCloud',
    subtitle: 'A private file cloud with a web interface, sharing and WebDAV access.',
    deployLink: {
      name: 'opencloud',
      binary:
        'https://github.com/opencloud-eu/opencloud/releases/download/v8.1.0/opencloud-8.1.0-linux-amd64',
      sha256: 'dcc57274dc9d66c02314f1bc45387bf41fd77a8662452c549adfb2e1a05783eb',
      port: 9200,
      arg: ['server'],
      env: [
        `HOME=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}`,
        `OC_CONFIG_DIR=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}`,
        `OC_BASE_DATA_PATH=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}/opencloud`,
        `OC_URL=https://${interpolableRuntimeValue(RUNTIME_VALUES.HOSTNAME.name)}`,
        'OC_INSECURE=true',
        'PROXY_TLS=false',
        'PROXY_INSECURE_BACKENDS=true',
        `PROXY_HTTP_ADDR=0.0.0.0:${interpolableRuntimeValue(RUNTIME_VALUES.HTTP_PORT.name)}`,
        'IDM_CREATE_DEMO_USERS=false',
        'STORAGE_USERS_POSIX_WATCH_FS=false',
        'OC_LOG_LEVEL=warn',
        'OC_MAX_CONCURRENCY=4',
        'GOMEMLIMIT=160MiB',
        'GOGC=50',
        'GOMAXPROCS=1',
        'AUTOMEMLIMIT=off',
      ],
      // Each installation needs its own initialized configuration supplied through Initial data.
      minimal: false,
    },
  },
  sharkord: {
    isRecommended: false,
    projectUrl: 'https://github.com/sharkord/sharkord',
    version: 'v0.0.25',
    markdownContent: sharkordPage,
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
    isRecommended: false,
    projectUrl: 'https://github.com/chrisgreg/boop',
    version: 'v1.3.0',
    markdownContent: boopPage,
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
    isRecommended: false,
    projectUrl: 'https://github.com/go-gitea/gitea',
    version: 'v1.28.0-dev-nibrun.4',
    markdownContent: giteaPage,
    category: DeployCategory.DeveloperTools,
    title: 'Gitea',
    subtitle:
      'A self-hosted Git service with repositories, issues, pull requests, packages and CI.',
    deployLink: {
      name: 'gitea',
      binary:
        'https://github.com/ilbertt/gitea/releases/download/v1.28.0-dev-nibrun.4/gitea-nibrun-linux-amd64',
      sha256: '22c6dbf7b76b60e92a1f5a37370d8de546de1a8a44d53e19483163260d448ba3',
      port: 3000,
      arg: ['nibrun'],
      minimal: true,
    },
  },
  'drizzle-gateway': {
    isRecommended: false,
    projectUrl: 'https://gateway.drizzle.team',
    version: 'v1.6.0',
    markdownContent: drizzleGatewayPage,
    category: DeployCategory.DeveloperTools,
    title: 'Drizzle Gateway',
    subtitle: 'A self-hosted Drizzle Studio for browsing and managing your SQL databases.',
    deployLink: {
      name: 'drizzle-gateway',
      binary: 'https://pub-e240a4fd7085425baf4a7951e7611520.r2.dev/drizzle-gateway-1.6.0-linux-x64',
      sha256: '793aaf0acb8db9d90b83cc9db78df82009051862acb995419b39d9497ddb51a5',
      port: 4983,
      env: [`STORE_PATH=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}`],
      minimal: true,
    },
  },
  'open-connector': {
    isRecommended: false,
    projectUrl: 'https://github.com/oomol-lab/open-connector',
    version: 'v1.8.0',
    markdownContent: openConnectorPage,
    category: DeployCategory.DeveloperTools,
    title: 'OpenConnector',
    subtitle: 'One OAuth hub for 1,000+ providers, with prebuilt actions your agents can call.',
    deployLink: {
      name: 'open-connector',
      binary:
        'https://github.com/oomol-lab/open-connector/releases/download/v1.8.0/open-connector-linux-x64',
      sha256: '042221049835b67c328f2bb948c864106944ace59bc2f125061251da272809a4',
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
    isRecommended: true,
    projectUrl: 'https://github.com/massimoalbarello/context-use',
    version: 'nibrun-latest',
    markdownContent: contextUsePage,
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
    isRecommended: false,
    projectUrl: 'https://github.com/ilbertt/nibrun-vitals',
    version: 'v2026.9.16-1',
    markdownContent: nibrunVitalsPage,
    category: DeployCategory.Analytics,
    title: 'nibrun-vitals',
    subtitle:
      'The microVM it runs on, as a face you can boop: live CPU, memory, disk, network, visitors and naps.',
    deployLink: {
      name: 'nibrun-vitals',
      binary:
        'https://github.com/ilbertt/nibrun-vitals/releases/download/v2026.9.16-1/vitals-linux-x64',
      sha256: '3131c0fc4e7bdc1954045f0844f189e2e31e3701d092633bd5dacda9c7d51446',
      port: 3000,
      minimal: true,
    },
  },
  picoshare: {
    isRecommended: false,
    projectUrl: 'https://github.com/mtlynch/picoshare',
    version: 'v1.5.4',
    markdownContent: picosharePage,
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
    isRecommended: false,
    projectUrl: 'https://github.com/usememos/memos',
    version: 'v0.31.0',
    markdownContent: memosPage,
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
    isRecommended: false,
    projectUrl: 'https://github.com/go-shiori/shiori',
    version: 'v1.8.0',
    markdownContent: shioriPage,
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
    isRecommended: false,
    projectUrl: 'https://github.com/0x2E/fusion',
    version: 'v1.3.0',
    markdownContent: fusionPage,
    category: DeployCategory.Feeds,
    title: 'Fusion',
    subtitle: 'An RSS reader for your own feeds, behind a password.',
    deployLink: {
      name: 'fusion',
      binary: 'https://github.com/0x2E/fusion/releases/download/v1.3.0/fusion-linux-amd64',
      sha256: 'fc2e52b878a1eaa7a5359bf0504feab7538be25a5a28e97292f1fcd0241e10f8',
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
    isRecommended: false,
    projectUrl: 'https://github.com/filebrowser/filebrowser',
    version: 'v2.63.23',
    markdownContent: filebrowserPage,
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
  openlist: {
    isRecommended: false,
    projectUrl: 'https://github.com/OpenListTeam/OpenList',
    version: 'v4.2.6',
    markdownContent: openlistPage,
    category: DeployCategory.FilesAndSharing,
    title: 'OpenList',
    subtitle: 'A file browser and WebDAV gateway for local files and cloud storage.',
    deployLink: {
      name: 'openlist',
      binary:
        'https://github.com/OpenListTeam/OpenList/releases/download/v4.2.6/openlist-linux-amd64.tar.gz',
      sha256: '2f2a5008efe45895292018479cb05556c83e828c3eed68a8b8cd3d35e82f03cb',
      port: 5244,
      arg: ['server', '--data', '/app/data', '--log-std'],
      env: [
        `HOME=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}`,
        `OPENLIST_HTTP_PORT=${interpolableRuntimeValue(RUNTIME_VALUES.HTTP_PORT.name)}`,
        `OPENLIST_SITE_URL=https://${interpolableRuntimeValue(RUNTIME_VALUES.HOSTNAME.name)}`,
        'GOMEMLIMIT=128MiB',
        'OPENLIST_ADMIN_PASSWORD',
      ],
      minimal: true,
    },
  },
  webdav: {
    isRecommended: false,
    projectUrl: 'https://github.com/rclone/rclone',
    version: 'v1.75.1',
    markdownContent: webdavPage,
    category: DeployCategory.FilesAndSharing,
    title: 'WebDAV',
    subtitle: 'A private file server you can connect to with any WebDAV client, powered by rclone.',
    deployLink: {
      name: 'webdav',
      binary:
        'https://github.com/rclone/rclone/releases/download/v1.75.1/rclone-v1.75.1-linux-amd64.zip',
      sha256: '982b5aa772841168f8e380f139e9e787b2a105403e32b94da8676a0e1c0a13ab',
      port: 8080,
      arg: [
        'serve',
        'webdav',
        '/app/data',
        '--addr',
        '0.0.0.0:8080',
        '--config',
        '/dev/null',
        '--cache-dir',
        '/tmp/rclone',
        '--buffer-size',
        '1M',
      ],
      env: ['RCLONE_USER', 'RCLONE_PASS'],
      minimal: true,
    },
  },
  microbin: {
    isRecommended: false,
    projectUrl: 'https://github.com/szabodanika/microbin',
    version: 'v2.1.0',
    markdownContent: microbinPage,
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
    isRecommended: false,
    projectUrl: 'https://github.com/arp242/goatcounter',
    version: 'v2.7.0',
    markdownContent: goatcounterPage,
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
    isRecommended: false,
    projectUrl: 'https://github.com/umputun/remark42',
    version: 'v1.17.1',
    markdownContent: remark42Page,
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
    isRecommended: false,
    projectUrl: 'https://github.com/traggo/server',
    version: 'v0.8.3',
    markdownContent: traggoPage,
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
    isRecommended: false,
    projectUrl: 'https://github.com/gotify/server',
    version: 'v3.1.1',
    markdownContent: gotifyPage,
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
    isRecommended: false,
    projectUrl: 'https://github.com/flipt-io/flipt',
    version: 'v2.13.1',
    markdownContent: fliptPage,
    title: 'Flipt',
    subtitle: 'Feature flags with a UI, evaluated over HTTP or gRPC.',
    category: DeployCategory.DeveloperTools,
    deployLink: {
      name: 'flipt',
      binary:
        'https://github.com/flipt-io/flipt/releases/download/v2.13.1/flipt_linux_x86_64.tar.gz',
      sha256: '5cefdf507eb4d2b5bb8fe3e167e2f7bf5ac83fbaed2b065693067beb2f96327a',
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
    isRecommended: true,
    projectUrl: 'https://github.com/massimoalbarello/open-sync',
    version: 'nibrun-latest',
    markdownContent: openSyncPage,
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
  'pdf-signer': {
    isRecommended: false,
    projectUrl: 'https://github.com/massimoalbarello/pdf-signer',
    version: 'nibrun-latest',
    markdownContent: pdfSignerPage,
    title: 'PDF Signer',
    subtitle: 'Your handwritten signature, kept once and stamped onto any PDF, behind a passkey.',
    category: DeployCategory.Productivity,
    deployLink: {
      name: 'pdf-signer',
      // No checksum, for the reason context-use carries none.
      binary:
        'https://github.com/massimoalbarello/pdf-signer/releases/download/nibrun-latest/pdf-signer',
      port: 3000,
      minimal: true,
    },
  },
  yarr: {
    isRecommended: false,
    projectUrl: 'https://github.com/nkanaev/yarr',
    version: 'v2.9',
    markdownContent: yarrPage,
    title: 'yarr',
    subtitle: 'A small feed reader, driven from the keyboard, that keeps everything in one file.',
    category: DeployCategory.Feeds,
    deployLink: {
      name: 'yarr',
      binary: 'https://github.com/nkanaev/yarr/releases/download/v2.9/yarr_linux_amd64.zip',
      sha256: 'fe0b176d53d77706760d00fe5232561437a3efd7b61d945eef09eedc7a7947f4',
      port: 7070,
      env: [
        'YARR_ADDR=0.0.0.0:7070',
        `YARR_DB=${interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name)}/yarr.db`,
        // Carried without a value, as `username:password`: yarr serves its api to anyone who
        // asks until this is set.
        'YARR_AUTH',
      ],
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
