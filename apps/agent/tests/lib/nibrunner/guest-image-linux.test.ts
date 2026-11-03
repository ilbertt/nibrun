import { expect, test } from 'bun:test';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GuestPathSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect } from 'effect';
import type { HostDesiredState } from '#lib/nibrunner/desired.gen.ts';
import { connectGuestSqlite } from '#lib/sqlite/client.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const enabled = process.platform === 'linux' && Bun.env.NIBRUN_TEST_NIBRUNNER_GUEST_IMAGE === '1';
const run = provided(platform);
const repo = join(import.meta.dir, '../../../../..');
const image = join(repo, 'infra/nibrunner-guest-image/dist');
const WAIT_TIMEOUT_MS = 120_000;
const POLL_MS = 100;
const EXECUTABLE_MODE = 0o755;
const VOLUME_BYTES = 67_108_864;
const REQUEST_TIMEOUT_MS = 5000;
const TEST_TIMEOUT_MS = 240_000;
const appId = `image-${process.pid}`;
const volumeId = `volume-${process.pid}`;

async function eventually<T>({
  description,
  read,
  accept,
}: {
  description: string;
  read: () => Promise<T>;
  accept: (value: T) => boolean;
}) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (accept(value)) {
        return value;
      }
      last = value;
    } catch (error) {
      last = error;
    }
    await Bun.sleep(POLL_MS);
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(last)}`);
}

async function availablePort() {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      return new Response();
    },
  });
  const port = server.port!;
  await server.stop(true);
  return port;
}

function config({ directory, port }: { directory: string; port: number }) {
  return `max_apps = 1
max_concurrent_vm_starts = 1
[cron]
max_jobs_per_app = 10
time_zone = "UTC"
[paths]
state_dir = "${directory}/state"
runtime_dir = "${directory}/run"
snapshot_dir = "${directory}/snapshots"
guest_image_dir = "${image}"
desired_state_file = "${directory}/desired.json"
versions_file = "${directory}/versions.json"
[artifacts]
store_url = "${directory}/artifacts"
[volumes]
backend = "local-file"
storage_prefix = "volumes"
[exports]
store_url = "${directory}/exports"
staging_dir = "${directory}/export-staging"
[network]
denied_egress_addresses_v4 = []
denied_egress_addresses_v6 = []
[proxy.http]
listen_address = "127.0.0.1"
port = ${port}
[filesystem]
socket = "${directory}/files.sock"
`;
}

async function fixture(directory: string) {
  if (process.getuid?.() !== 0) {
    throw new Error('Guest image integration requires root.');
  }
  const binary = join(image, 'stock/nibrunnerd-linux-x64');
  await chmod(binary, EXECUTABLE_MODE);
  const port = await availablePort();
  const configuration = join(directory, 'config.toml');
  await writeFile(configuration, config({ directory, port }));
  await mkdir(join(directory, 'artifacts'), { recursive: true });
  const artifact = Bun.file(join(image, 'test-app'));
  const bytes = await artifact.arrayBuffer();
  await Bun.write(join(directory, 'artifacts/app'), bytes);
  const desired: HostDesiredState = {
    hostId: 'image-test',
    revision: 'initial',
    volumes: [{ appId, volumeId, sizeBytes: VOLUME_BYTES, desiredState: 'present' }],
    instances: [
      {
        appId,
        deploymentId: 'image-deployment',
        volumeId,
        desiredState: 'running',
        access: { kind: 'public' },
        layers: [
          {
            kind: 'executable',
            objectKey: 'app',
            digest: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
            destinationPath: '/app/server',
          },
        ],
        config: {
          httpPort: 3000,
          command: { program: '/app/server', args: [], workingDirectory: '/app', environment: {} },
          resources: { vcpuCount: 1, memoryMib: 256 },
          healthCheck: {
            kind: 'tcp',
            intervalMs: 1000,
            timeoutMs: 1000,
            gracePeriodMs: 30000,
            healthyThreshold: 1,
            unhealthyThreshold: 3,
          },
          restartPolicy: {
            maxRestarts: 0,
            initialBackoffMs: 500,
            maxBackoffMs: 30000,
            backoffFactor: 2,
            resetAfterMs: 60000,
          },
        },
        hostnames: [{ hostname: 'image.test', kind: 'platform' }],
      },
    ],
    checkpoints: [],
    exports: [],
  };
  async function write() {
    await writeFile(join(directory, 'desired.next'), JSON.stringify(desired));
    await rename(join(directory, 'desired.next'), join(directory, 'desired.json'));
  }
  await write();
  const environment = { ...process.env, NIBRUNNER_CONFIG: configuration };
  const installed = Bun.spawn([binary, 'install', '--from', image], {
    env: environment,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if ((await installed.exited) !== 0) {
    throw new Error('The pinned engine refused the guest image.');
  }
  const daemon = Bun.spawn([binary], { env: environment, stdout: 'inherit', stderr: 'inherit' });
  async function state() {
    const report = JSON.parse(await readFile(join(directory, 'state/reported.json'), 'utf8'));
    return report.instances.find((instance: { appId: string }) => instance.appId === appId)?.state;
  }
  async function request(path: string) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { host: 'image.test' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`App request failed: ${response.status}`);
    }
    return response.text();
  }
  async function socket() {
    const record = (await Bun.file(join(directory, 'run', `vm-${appId}.json`)).json()) as {
      jailRoot: string;
    };
    return join(record.jailRoot, 'logs.vsock');
  }

  async function close() {
    try {
      desired.instances = [];
      await write();
      await eventually({
        description: 'the guest to stop before cleanup',
        read: state,
        accept: (value) => value === undefined,
      });
    } finally {
      daemon.kill('SIGTERM');
      await daemon.exited;
    }
  }
  return { desired, write, state, request, socket, close };
}

test.skipIf(!enabled)(
  'the derived image keeps stock init and serves SQLite independently of its app',
  async () => {
    await run(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectory;
        const host = yield* Effect.acquireRelease(
          Effect.promise(() => fixture(directory)),
          (host) => Effect.promise(host.close),
        );
        yield* Effect.promise(() =>
          eventually({
            description: 'a running app',
            read: host.state,
            accept: (state) => state === 'running',
          }),
        );
        const pid = yield* Effect.promise(() =>
          eventually({
            description: 'the HTTP route',
            read: () => host.request('/'),
            accept: (body) => /^\d+$/.test(body),
          }),
        );
        yield* Effect.promise(() => host.request('/cron'));
        const socketPath = yield* Effect.promise(host.socket);
        yield* Effect.scoped(
          Effect.gen(function* () {
            const client = yield* connectGuestSqlite({ socketPath });
            yield* client.open(Value.Parse(GuestPathSchema, '/app.db'));
            const first = yield* client.pipeline({
              requests: [
                { type: 'execute', stmt: { sql: "SELECT value, x'00ff' AS bytes FROM kept" } },
              ],
            });
            expect(JSON.stringify(first)).toContain('9223372036854775807');
            expect(JSON.stringify(first)).toContain('AP8=');
            yield* Effect.promise(() => host.request('/write'));
            const second = yield* client.pipeline({
              baton: first.baton,
              requests: [{ type: 'execute', stmt: { sql: 'SELECT count(*) AS total FROM kept' } }],
            });
            expect(JSON.stringify(second)).toContain('"value":"2"');
            const rejected = yield* client.pipeline({
              baton: second.baton,
              requests: [{ type: 'execute', stmt: { sql: 'DELETE FROM kept' } }],
            });
            expect(JSON.stringify(rejected)).toContain('SQLITE_READONLY');
          }),
        );
        yield* Effect.promise(() => host.request('/memory'));
        yield* Effect.scoped(
          Effect.gen(function* () {
            const client = yield* connectGuestSqlite({ socketPath });
            yield* client.open(Value.Parse(GuestPathSchema, '/app.db'));
            const pressure = yield* Effect.either(
              client.pipeline({
                requests: [
                  {
                    type: 'execute',
                    stmt: {
                      sql: 'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000) SELECT hex(zeroblob(60000)) FROM n ORDER BY random()',
                    },
                  },
                ],
              }),
            );
            if (pressure._tag === 'Right') {
              expect(pressure.right.results[0]?.type).toBe('error');
            }
          }),
        );
        expect(yield* Effect.promise(() => host.request('/'))).toBe(pid);
        yield* Effect.promise(() => host.request('/replace-data'));
        yield* Effect.scoped(
          Effect.gen(function* () {
            const client = yield* connectGuestSqlite({ socketPath });
            expect(
              (yield* Effect.either(client.open(Value.Parse(GuestPathSchema, '/outside.db'))))._tag,
            ).toBe('Left');
          }),
        );
        yield* Effect.promise(() => host.request('/restore-data'));
        host.desired.instances[0]!.desiredState = 'stopped';
        yield* Effect.promise(host.write);
        yield* Effect.promise(() =>
          eventually({
            description: 'a stopped app',
            read: host.state,
            accept: (state) => state === 'stopped',
          }),
        );
        host.desired.instances[0]!.desiredState = 'running';
        yield* Effect.promise(host.write);
        yield* Effect.promise(() =>
          eventually({
            description: 'the restarted app',
            read: host.state,
            accept: (state) => state === 'running',
          }),
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const client = yield* connectGuestSqlite({
              socketPath: yield* Effect.promise(host.socket),
            });
            yield* client.open(Value.Parse(GuestPathSchema, '/app.db'));
            const result = yield* client.pipeline({
              requests: [{ type: 'execute', stmt: { sql: 'SELECT count(*) AS total FROM kept' } }],
            });
            expect(JSON.stringify(result)).toContain('"value":"4"');
          }),
        );
      }),
    );
  },
  TEST_TIMEOUT_MS,
);
