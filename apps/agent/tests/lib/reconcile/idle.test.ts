import { describe, expect, test } from 'bun:test';
import { INSTANCE_STATES, type InstanceState } from '@repo/protocol';
import { hasGoneQuiet } from '#lib/reconcile/idle.ts';
import { instanceRecord } from '#tests/support/fixtures.ts';

const TIMEOUT_MS = 900_000;
const NOW_MS = 10_000_000;
const QUIET_SINCE_MS = NOW_MS - TIMEOUT_MS;
const BUSY_SINCE_MS = NOW_MS - TIMEOUT_MS + 1;

/** The two an app can be stopped from: up and serving, or up and not answering. */
const AWAKE_STATES: InstanceState[] = ['running', 'unhealthy'];

function quiet(overrides: Partial<Parameters<typeof hasGoneQuiet>[0]>) {
  return hasGoneQuiet({
    record: instanceRecord({ onRequest: true, state: 'running' }),
    timeoutMs: TIMEOUT_MS,
    lastActiveAtMs: QUIET_SINCE_MS,
    nowMs: NOW_MS,
    ...overrides,
  });
}

describe('an app is only let go to sleep once it is certain nobody wants it', () => {
  test.each(AWAKE_STATES)('a quiet %s app has gone quiet', (state) => {
    expect(quiet({ record: instanceRecord({ onRequest: true, state }) })).toBe(true);
  });

  test('one asked for a moment ago has not', () => {
    expect(quiet({ lastActiveAtMs: BUSY_SINCE_MS })).toBe(false);
  });

  test('an app that is kept up is never let go, however quiet it is', () => {
    expect(quiet({ record: instanceRecord({ onRequest: false, state: 'running' }) })).toBe(false);
  });

  test('nor is a suspended one: it is already going down for another reason', () => {
    expect(
      quiet({
        record: instanceRecord({ onRequest: true, state: 'running', desiredRunning: false }),
      }),
    ).toBe(false);
  });

  test.each(INSTANCE_STATES.filter((state) => !AWAKE_STATES.includes(state)))(
    'a %s app has no microVM to stop',
    (state) => {
      expect(quiet({ record: instanceRecord({ onRequest: true, state }) })).toBe(false);
    },
  );

  /**
   * The two ways of knowing nothing. A restarted agent has watched no traffic yet, and an app
   * desired state no longer calls `on-request` has no timeout to be measured against — both are
   * questions this cannot answer, and answering them by stopping a tenant is the wrong guess.
   */
  test('an app nothing has been observed about is left alone', () => {
    expect(quiet({ lastActiveAtMs: undefined })).toBe(false);
  });

  test('so is one with no timeout to have run out', () => {
    expect(quiet({ timeoutMs: undefined })).toBe(false);
  });
});
