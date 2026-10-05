import { expect, test } from 'bun:test';
import { DEFAULT_AGENT_POLL_SETTINGS } from '#lib/agent-poll-settings.ts';

test('the poll settings the control plane hands out are themselves valid', () => {
  expect(DEFAULT_AGENT_POLL_SETTINGS.minIntervalMs).toBeGreaterThan(0);
  expect(DEFAULT_AGENT_POLL_SETTINGS.minIntervalMs).toBeLessThan(
    DEFAULT_AGENT_POLL_SETTINGS.reportIntervalMs,
  );
});
