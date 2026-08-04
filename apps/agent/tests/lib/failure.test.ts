import { describe, expect, test } from 'bun:test';
import type { Sha256Digest } from '@repo/protocol';
import { InstanceCredentialsError } from '#lib/aws/credentials.ts';
import { ControlPlaneError } from '#lib/control/client.ts';
import { CommandFailed, CommandTimedOut } from '#lib/exec.ts';
import { EmptyDump, UnsafeFilename } from '#lib/exports/bundle.ts';
import { reportedMessage } from '#lib/failure.ts';
import { MalformedJsonError } from '#lib/json-store.ts';
import { InvalidGuestLogFrame } from '#lib/logs/guest-protocol.ts';
import { SlotExhausted } from '#lib/network/allocator.ts';
import { ProtocolMismatch } from '#lib/protocol.ts';
import { MissingVersionsError } from '#lib/report/versions.ts';
import { ArtifactSizeMismatch, DigestMismatch } from '#lib/vm/artifacts.ts';
import { UnrepresentableEnvironment } from '#lib/vm/instance-env.ts';
import { VolumeShrinkRefused } from '#lib/volumes/device-file.ts';
import { ArtifactTransferError } from '#services/artifact-store.service.ts';

const DIGEST_HEX_LENGTH = 64;
const HTTP_UNAUTHORIZED = 401;
const MAX_MESSAGE_LENGTH = 512;
const SOME_SIZE = 4_096;
const OTHER_SIZE = 8_192;
const SOME_LIMIT = 200;

const everyFailure = [
  new SlotExhausted({ limit: SOME_LIMIT }),
  new DigestMismatch({ expected: 'a'.repeat(DIGEST_HEX_LENGTH) as Sha256Digest, actual: 'b' }),
  new ArtifactSizeMismatch({ expected: SOME_SIZE, actual: OTHER_SIZE }),
  new ArtifactTransferError({ cause: new Error('connection reset') }),
  new UnrepresentableEnvironment({ variableName: 'API_KEY' }),
  new EmptyDump({ devicePath: '/dev/nbd7' }),
  new UnsafeFilename({ filename: '../escape' }),
  new MalformedJsonError({ path: '/var/lib/nibrun/slots.json', cause: new Error('bad token') }),
  new InvalidGuestLogFrame({ reason: 'unknown frame kind' }),
  new MissingVersionsError({ path: '/opt/nibrun/bundle/versions.json' }),
  new InstanceCredentialsError({ detail: 'no role is attached' }),
  new CommandFailed({
    command: ['mkfs.ext4', '/dev/nbd3'],
    result: { code: 1, stdout: '', stderr: 'banner\nis not a block device' },
  }),
  new CommandTimedOut({ command: ['debugfs', '-R', 'rdump / /tmp/x', '/dev/nbd7'] }),
  new VolumeShrinkRefused({ current: OTHER_SIZE, requested: SOME_SIZE }),
  new ControlPlaneError({ status: HTTP_UNAUTHORIZED, route: '/desired-state', body: 'expired' }),
  new ProtocolMismatch({ issues: [] }),
];

// The message is what a report carries to the control plane, and from there to whoever is
// looking at a failed instance. An error that renders as its own tag tells them nothing.
describe('every failure describes itself', () => {
  test.each(everyFailure)('$_tag reads as a sentence rather than as its tag', (failure) => {
    expect(failure.message.length).toBeGreaterThan(failure._tag.length);
    expect(failure.message).not.toContain('{');
  });
});

describe('what a message may not carry', () => {
  // The one error raised while holding a tenant secret, and the reason it names the variable.
  test('a refused variable names itself and never its value', () => {
    const refused = new UnrepresentableEnvironment({ variableName: 'API_KEY' });

    expect(refused.message).toContain('API_KEY');
    expect(JSON.stringify(refused)).not.toContain('message');
  });

  test('a report message is bounded, whatever a subprocess wrote to stderr', () => {
    const shouting = new CommandFailed({
      command: ['mkfs.ext4', '/dev/nbd3'],
      result: { code: 1, stdout: '', stderr: 'x'.repeat(MAX_MESSAGE_LENGTH * 2) },
    });

    expect(reportedMessage(shouting).length).toBe(MAX_MESSAGE_LENGTH);
  });
});

test('a failed command reports the last line of stderr, not the banner above it', () => {
  const failed = new CommandFailed({
    command: ['nbd-client', '/dev/nbd3'],
    result: {
      code: 1,
      stdout: '',
      stderr: 'Negotiation: ..\nError: Socket failed: Connection refused',
    },
  });

  expect(reportedMessage(failed)).toBe(
    'nbd-client exited 1: Error: Socket failed: Connection refused',
  );
});
