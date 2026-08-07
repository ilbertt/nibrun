import { describe, expect, test } from 'bun:test';
import { type AppId, AppIdSchema, Value } from '@repo/protocol';
import { Either } from 'effect';
import { tenantLogSocketPath } from '#lib/logs/vsock.ts';
import {
  connectRequest,
  GUEST_CONTROL_VSOCK_PORT,
  guestVsockPath,
  readConnectReply,
  vmWorkingDir,
} from '#lib/vm/vsock.ts';

const APP_ID: AppId = Value.Parse(AppIdSchema, 'pocketbase-8zv0ch');

describe('the VM vsock device', () => {
  test('the host dials the device itself and the guest answers on a suffixed path', () => {
    const workingDir = vmWorkingDir({ vmDir: '/var/lib/nibrun/vm', appId: APP_ID });

    expect(guestVsockPath({ workingDir })).toBe('/var/lib/nibrun/vm/pocketbase-8zv0ch/logs.vsock');
    expect(tenantLogSocketPath({ workingDir })).toBe(
      '/var/lib/nibrun/vm/pocketbase-8zv0ch/logs.vsock_51000',
    );
  });
});

describe("Firecracker's host-initiated handshake", () => {
  test('asks for the control port by number', () => {
    expect(connectRequest(GUEST_CONTROL_VSOCK_PORT)).toBe('CONNECT 51001\n');
  });

  test('accepts the reply that names the port it bound', () => {
    const accepted = readConnectReply({ reply: 'OK 1234', port: GUEST_CONTROL_VSOCK_PORT });

    expect(Either.isRight(accepted)).toBe(true);
  });

  /* A VMM that is there and a guest that is not listening: the export must fail rather than read a
   * device whose journal still holds the tenant's last writes. */
  test('refuses anything else, so an unlistened port is not mistaken for a stopped app', () => {
    for (const reply of ['FAILED', '', 'OK', 'NOT OK 1234']) {
      const refused = readConnectReply({ reply, port: GUEST_CONTROL_VSOCK_PORT });

      expect(Either.isLeft(refused)).toBe(true);
    }
  });
});
