import type { AgentPollSettings } from '@repo/protocol';

/**
 * A quarter of a second, because this is what a deploy waits out before anything has begun.
 *
 * A change lands at no particular point in the interval, so what it costs on average is half of
 * one: at a second that was ~500ms on the front of every deploy, spent ahead of the artifact, the
 * boot and the guest — and against a deploy measured at 1.6s for a small binary, the largest
 * single thing the control plane was contributing.
 *
 * What a shorter one costs is polls, and the fleet is what decides whether that is dear rather
 * than this number. It is the control plane's to set for precisely that reason: it can be raised
 * again for every host at once without redeploying a single agent.
 *
 * Holding the request open is what stops notice-latency and request rate being the same dial at
 * all, and is the answer at the point where lowering this stops being cheap. It is not that point
 * while a host is something there is one of.
 */
const DEFAULT_MIN_INTERVAL_MS = 250;
const DEFAULT_REPORT_INTERVAL_MS = 15_000;

export const DEFAULT_AGENT_POLL_SETTINGS: AgentPollSettings = {
  minIntervalMs: DEFAULT_MIN_INTERVAL_MS,
  reportIntervalMs: DEFAULT_REPORT_INTERVAL_MS,
};
