import type { AgentPollSettings } from '@repo/protocol';

// Only used without a cached session; once registered, the API chooses both intervals.
export const UNREGISTERED_POLL_SETTINGS: AgentPollSettings = {
  minIntervalMs: 250,
  reportIntervalMs: 15_000,
};
