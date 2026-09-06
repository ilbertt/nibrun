import { describe, expect, test } from 'bun:test';
import {
  type HostId,
  HostIdSchema,
  type SecretString,
  SecretStringSchema,
  Value,
} from '@repo/protocol';
import { AgentSessions } from '#lib/agent/sessions.ts';

const HOST: HostId = Value.Parse(HostIdSchema, 'host-1');
const TOKEN: SecretString = Value.Parse(SecretStringSchema, 'token-1');

const OPENED_AT = new Date('2026-01-01T00:00:00.000Z');
const EXPIRES_AT = new Date('2026-01-01T01:00:00.000Z');

function opened(): AgentSessions {
  const sessions = new AgentSessions();
  sessions.open({ sessionToken: TOKEN, hostId: HOST, expiresAt: EXPIRES_AT });
  return sessions;
}

describe('a session is the host it was opened for until it lapses', () => {
  test('a token presented before it expires resolves to its host', () => {
    expect(opened().hostFor({ sessionToken: TOKEN, now: OPENED_AT })).toBe(HOST);
  });

  test('one presented after it expires resolves to nothing', () => {
    expect(opened().hostFor({ sessionToken: TOKEN, now: EXPIRES_AT })).toBeUndefined();
  });

  test('a token nobody opened resolves to nothing', () => {
    expect(opened().hostFor({ sessionToken: 'never-issued', now: OPENED_AT })).toBeUndefined();
  });

  // The lifetime the host was told about is the one that binds, so a lapsed token stays lapsed
  // rather than being honoured again by a later clock reading.
  test('one refused for having lapsed is not honoured by a reading taken earlier', () => {
    const sessions = opened();

    expect(sessions.hostFor({ sessionToken: TOKEN, now: EXPIRES_AT })).toBeUndefined();
    expect(sessions.hostFor({ sessionToken: TOKEN, now: OPENED_AT })).toBeUndefined();
  });

  test('reopening a token gives it the lifetime it was reopened with', () => {
    const sessions = opened();
    const later = new Date('2026-01-01T02:00:00.000Z');
    sessions.open({ sessionToken: TOKEN, hostId: HOST, expiresAt: later });

    expect(sessions.hostFor({ sessionToken: TOKEN, now: EXPIRES_AT })).toBe(HOST);
  });
});
