import type { S3VolumeStorage } from '@repo/protocol';

type ZerofsConfig = {
  storage: S3VolumeStorage;
  cache: {
    directory: string;
    diskSizeGb: number;
    memorySizeGb: number;
  };
  sockets: {
    nbd: string;
    ninep: string | undefined;
    rpc: string | undefined;
  };
  readOnly: boolean;
};

const FLUSH_INTERVAL_SECONDS = 5;

// ZeroFS expands environment references after parsing TOML, including inside secrets.
function tomlString(value: string): string {
  return JSON.stringify(value.split('$').join('$$'));
}

function storageUrl(storage: S3VolumeStorage): string {
  const prefix = storage.prefix.split('/').map(encodeURIComponent).join('/');
  return `s3://${storage.bucket}/${prefix}`;
}

function socketSections(sockets: ZerofsConfig['sockets']): string[] {
  return Object.entries(sockets).flatMap(([name, socket]) =>
    socket === undefined ? [] : [`[servers.${name}]`, `unix_socket = ${tomlString(socket)}`, ''],
  );
}

export function renderZerofsConfig({ storage, cache, sockets, readOnly }: ZerofsConfig): string {
  return [
    '[cache]',
    `dir = ${tomlString(cache.directory)}`,
    `disk_size_gb = ${cache.diskSizeGb}`,
    `memory_size_gb = ${cache.memorySizeGb}`,
    'warm_metadata = "filters_index"',
    '',
    '[storage]',
    `url = ${tomlString(storageUrl(storage))}`,
    `encryption_password = ${tomlString(storage.encryptionPassword)}`,
    '',
    '[aws]',
    `endpoint = ${tomlString(storage.endpoint)}`,
    `region = ${tomlString(storage.region)}`,
    `access_key_id = ${tomlString(storage.accessKeyId)}`,
    `secret_access_key = ${tomlString(storage.secretAccessKey)}`,
    ...(storage.sessionToken === undefined
      ? []
      : [`session_token = ${tomlString(storage.sessionToken)}`]),
    'virtual_hosted_style_request = "false"',
    '',
    ...(readOnly
      ? []
      : [
          '[filesystem]',
          'ignore_fsync = true',
          'compression = "zstd-3"',
          '',
          '[lsm]',
          `flush_interval_secs = ${FLUSH_INTERVAL_SECONDS}`,
          '',
        ]),
    ...socketSections(sockets),
    '[telemetry]',
    'enabled = false',
    '',
  ].join('\n');
}
