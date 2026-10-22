import { join } from 'node:path';
import { FileSystem } from '@effect/platform';
import { Effect, Schedule } from 'effect';
import type { CommandLine } from '#lib/exec.ts';
import { stdoutOf } from '#services/command-runner.service.ts';
import { temporaryDirectory } from '#tests/support/run.ts';
import { s3Storage } from '#tests/support/s3-storage.ts';

const RUSTFS_IMAGE =
  'rustfs/rustfs:1.0.0@sha256:8cc9801755448b71a786705ce76692c77e14936cccd87cf2fc31842e58f4d1ff';
const REGION = 'us-east-1';

function certificates(directory: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const certs = join(directory, 'certs');
    const certificate = join(directory, 'ca.crt');
    const authorityKey = join(directory, 'ca.key');
    const request = join(directory, 'server.csr');
    const extensions = join(directory, 'extensions.cnf');
    yield* fs.makeDirectory(certs);
    yield* fs.writeFileString(
      extensions,
      'subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\n',
    );
    const commands: CommandLine[] = [
      [
        'openssl',
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        authorityKey,
        '-out',
        certificate,
        '-days',
        '1',
        '-subj',
        '/CN=nibrun-integration-ca',
        '-addext',
        'basicConstraints=critical,CA:TRUE',
      ],
      [
        'openssl',
        'req',
        '-new',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        join(certs, 'rustfs_key.pem'),
        '-out',
        request,
        '-subj',
        '/CN=localhost',
      ],
      [
        'openssl',
        'x509',
        '-req',
        '-in',
        request,
        '-CA',
        certificate,
        '-CAkey',
        authorityKey,
        '-CAcreateserial',
        '-out',
        join(certs, 'rustfs_cert.pem'),
        '-days',
        '1',
        '-extfile',
        extensions,
      ],
    ];
    for (const command of commands) {
      yield* stdoutOf({ command });
    }
    return { certs, certificate };
  });
}

export function s3Backend() {
  return Effect.gen(function* () {
    const directory = yield* temporaryDirectory;
    const { certs, certificate } = yield* certificates(directory);
    const name = `nibrun-zerofs-test-${crypto.randomUUID()}`;
    const auth = {
      kind: 'access-key',
      accessKeyId: 'nibrun-integration',
      secretAccessKey: crypto.randomUUID(),
    } as const;
    yield* stdoutOf({
      command: [
        'docker',
        'create',
        '--name',
        name,
        '--user',
        '0:0',
        '--publish',
        '127.0.0.1::9000',
        '--env',
        `RUSTFS_ACCESS_KEY=${auth.accessKeyId}`,
        '--env',
        `RUSTFS_SECRET_KEY=${auth.secretAccessKey}`,
        '--env',
        'RUSTFS_TLS_PATH=/certs',
        RUSTFS_IMAGE,
      ],
      timeout: '5 minutes',
    });
    yield* Effect.addFinalizer(() =>
      stdoutOf({ command: ['docker', 'rm', '--force', '--volumes', name] }).pipe(Effect.ignore),
    );
    yield* stdoutOf({ command: ['docker', 'cp', `${certs}/.`, `${name}:/certs`] });
    yield* stdoutOf({ command: ['docker', 'start', name] });
    const address = (yield* stdoutOf({ command: ['docker', 'port', name, '9000/tcp'] })).trim();
    const endpoint = `https://${address}`;
    const curl: CommandLine = [
      'curl',
      '--fail-with-body',
      '--silent',
      '--show-error',
      '--noproxy',
      '*',
      '--connect-timeout',
      '2',
      '--max-time',
      '5',
      '--cacert',
      certificate,
    ];
    yield* stdoutOf({ command: [...curl, `${endpoint}/health`] }).pipe(
      Effect.retry(Schedule.spaced('100 millis').pipe(Schedule.upTo('30 seconds'))),
    );
    const storage = s3Storage({ endpoint, bucket: 'nibrun-integration', region: REGION, auth });
    const signed: CommandLine = [
      ...curl,
      '--aws-sigv4',
      `aws:amz:${REGION}:s3`,
      '--user',
      `${auth.accessKeyId}:${auth.secretAccessKey}`,
    ];
    yield* stdoutOf({
      command: [...signed, '--request', 'PUT', `${endpoint}/${storage.bucket}`],
    }).pipe(Effect.retry(Schedule.spaced('100 millis').pipe(Schedule.upTo('30 seconds'))));
    return {
      storage,
      certificate,
      list: stdoutOf({ command: [...signed, `${endpoint}/${storage.bucket}?list-type=2`] }),
      stop: stdoutOf({ command: ['docker', 'stop', name] }),
    };
  });
}
