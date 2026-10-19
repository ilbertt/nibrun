import { describe, expect, test } from 'bun:test';
import { renderZerofsConfig } from '#lib/volumes/zerofs-config.ts';
import { s3Storage as storage } from '#tests/support/s3-storage.ts';

function rendered(overrides: Partial<Parameters<typeof renderZerofsConfig>[0]> = {}) {
  return renderZerofsConfig({
    storage: storage(),
    cache: { directory: '/data/zerofs/app-1', diskSizeGb: 4, memorySizeGb: 0.25 },
    sockets: {
      nbd: '/run/zerofs/app-1/nbd.sock',
      ninep: '/run/zerofs/app-1/9p.sock',
      rpc: '/run/zerofs/app-1/rpc.sock',
    },
    readOnly: false,
    ...overrides,
  });
}

describe('per-app ZeroFS configuration', () => {
  test('uses the supplied bucket and credentials with independent local paths', () => {
    expect(Bun.TOML.parse(rendered())).toEqual({
      cache: {
        dir: '/data/zerofs/app-1',
        disk_size_gb: 4,
        memory_size_gb: 0.25,
        warm_metadata: 'filters_index',
      },
      storage: {
        url: 's3://customer-data/apps/app-1',
        encryption_password: 'customer-filesystem-password',
      },
      aws: {
        endpoint: 'https://objects.example.com',
        region: 'eu-central-1',
        skip_signature: 'false',
        access_key_id: 'customer-access-key',
        secret_access_key: 'customer-secret-key',
        virtual_hosted_style_request: 'false',
      },
      filesystem: { ignore_fsync: true, compression: 'zstd-3' },
      lsm: { flush_interval_secs: 5 },
      servers: {
        nbd: { unix_socket: '/run/zerofs/app-1/nbd.sock' },
        ninep: { unix_socket: '/run/zerofs/app-1/9p.sock' },
        rpc: { unix_socket: '/run/zerofs/app-1/rpc.sock' },
      },
      telemetry: { enabled: false },
    });
  });

  test('preserves temporary credentials', () => {
    const config = Bun.TOML.parse(
      rendered({
        storage: storage({
          auth: {
            kind: 'session',
            accessKeyId: 'temporary-access-key',
            secretAccessKey: 'temporary-secret-key',
            sessionToken: 'session-token',
          },
        }),
      }),
    );
    expect(config).toHaveProperty('aws.skip_signature', 'false');
    expect(config).toHaveProperty('aws.access_key_id', 'temporary-access-key');
    expect(config).toHaveProperty('aws.secret_access_key', 'temporary-secret-key');
    expect(config).toHaveProperty('aws.session_token', 'session-token');
  });

  test('anonymous access disables signing without emitting credentials', () => {
    const config = Bun.TOML.parse(rendered({ storage: storage({ auth: { kind: 'anonymous' } }) }));
    expect(config).toHaveProperty('aws', {
      endpoint: 'https://objects.example.com',
      region: 'eu-central-1',
      skip_signature: 'true',
      virtual_hosted_style_request: 'false',
    });
  });

  test('an omitted region uses a fixed signing region instead of the host environment', () => {
    const config = Bun.TOML.parse(rendered({ storage: storage({ region: undefined }) }));
    expect(config).toHaveProperty('aws.region', 'us-east-1');
    expect(config).not.toHaveProperty('aws.session_token');
  });

  test('escapes TOML syntax and prevents ZeroFS from expanding tenant dollar signs', () => {
    const config = Bun.TOML.parse(
      rendered({
        storage: storage({
          auth: {
            kind: 'access-key',
            accessKeyId: 'customer-access-key',
            secretAccessKey: `quotes"\\\n\${AWS_SECRET_ACCESS_KEY}`,
          },
          encryptionPassword: `$literal-\${HOME}`,
          prefix: 'apps/data #1?version=2',
        }),
      }),
    );
    expect(config).toHaveProperty('aws.secret_access_key', `quotes"\\\n$\${AWS_SECRET_ACCESS_KEY}`);
    expect(config).toHaveProperty('storage', {
      url: 's3://customer-data/apps/data%20%231%3Fversion%3D2',
      encryption_password: `$$literal-$\${HOME}`,
    });
  });

  test('checkpoint readers omit write policy and unneeded listeners', () => {
    const config = Bun.TOML.parse(
      rendered({
        readOnly: true,
        sockets: { nbd: '/run/checkpoint/nbd.sock', ninep: undefined, rpc: undefined },
      }),
    );
    expect(config).not.toHaveProperty('filesystem');
    expect(config).not.toHaveProperty('lsm');
    expect(config).not.toHaveProperty('prometheus');
    expect(config).toHaveProperty('servers', { nbd: { unix_socket: '/run/checkpoint/nbd.sock' } });
  });

  test('preserves literal percent escapes in object prefixes', () => {
    const config = Bun.TOML.parse(rendered({ storage: storage({ prefix: 'apps/a%2Fb/été' }) }));
    expect(config).toHaveProperty('storage.url', 's3://customer-data/apps/a%252Fb/%C3%A9t%C3%A9');
  });
});
