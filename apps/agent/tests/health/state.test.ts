import { describe, expect, test } from 'bun:test';
import { DEFAULT_HEALTH_CHECK, type HealthCheck } from '@repo/protocol';
import { applyProbe, evaluateInstanceState, initialTracker } from '#health/state.ts';
import { OBSERVED_AT } from '#tests/support/fixtures.ts';
import type { UnitStatus } from '#vm/unit-status.ts';

const STARTED_AT_MS = 1_000_000;
const GRACE_MS = DEFAULT_HEALTH_CHECK.gracePeriodMs;
const WITHIN_GRACE_MS = STARTED_AT_MS + GRACE_MS - 1;
const PAST_GRACE_MS = STARTED_AT_MS + GRACE_MS + 1;

const UNHEALTHY_RUN = DEFAULT_HEALTH_CHECK.unhealthyThreshold;
const HEALTHY_THRESHOLD = DEFAULT_HEALTH_CHECK.healthyThreshold;
const TWO_SUCCESSES = 2;

type Tracker = ReturnType<typeof initialTracker>;

const active: UnitStatus = { loaded: true, active: true, failed: false, startedThisBoot: true };
const exited: UnitStatus = {
  loaded: true,
  active: false,
  failed: false,
  startedThisBoot: true,
  exitCode: 0,
};
const crashed: UnitStatus = {
  loaded: true,
  active: false,
  failed: true,
  startedThisBoot: true,
  exitCode: 1,
};
const absent: UnitStatus = {
  loaded: false,
  active: false,
  failed: false,
  startedThisBoot: false,
};

function check(overrides: Partial<HealthCheck> = {}): HealthCheck {
  return { ...DEFAULT_HEALTH_CHECK, ...overrides };
}

function probe({
  tracker,
  healthy,
  healthyThreshold = HEALTHY_THRESHOLD,
}: {
  tracker: Tracker;
  healthy: boolean;
  healthyThreshold?: number;
}) {
  return applyProbe({ tracker, healthy, at: OBSERVED_AT, healthyThreshold });
}

function failing(count: number) {
  let tracker = initialTracker();
  for (let index = 0; index < count; index += 1) {
    tracker = probe({ tracker, healthy: false });
  }
  return tracker;
}

function healthyThen(failures: number) {
  let tracker = probe({ tracker: initialTracker(), healthy: true });
  for (let index = 0; index < failures; index += 1) {
    tracker = probe({ tracker, healthy: false });
  }
  return tracker;
}

function evaluate({
  unit,
  tracker,
  nowMs,
  healthCheck = check(),
  stopRequested = false,
  desiredRunning = true,
  startedAtMs = STARTED_AT_MS as number | undefined,
}: {
  unit: UnitStatus;
  tracker: Tracker;
  nowMs: number;
  healthCheck?: HealthCheck;
  stopRequested?: boolean;
  desiredRunning?: boolean;
  startedAtMs?: number | undefined;
}) {
  return evaluateInstanceState({
    unit,
    tracker,
    healthCheck,
    desiredRunning,
    stopRequested,
    ...(startedAtMs === undefined ? {} : { startedAtMs }),
    nowMs,
  });
}

describe('probe accounting', () => {
  test('a success resets the failure run and records when it happened', () => {
    const tracker = probe({ tracker: failing(2), healthy: true });
    expect(tracker).toEqual({
      consecutiveSuccesses: 1,
      consecutiveFailures: 0,
      everHealthy: true,
      lastHealthyAt: OBSERVED_AT,
    });
  });

  test('a failure resets the success run but not the fact it was once healthy', () => {
    const tracker = probe({
      tracker: probe({ tracker: initialTracker(), healthy: true }),
      healthy: false,
    });
    expect(tracker.consecutiveSuccesses).toBe(0);
    expect(tracker.consecutiveFailures).toBe(1);
    expect(tracker.everHealthy).toBe(true);
  });
});

describe('a booted VM is not a running app', () => {
  test('active with no successful probe is starting, not running', () => {
    expect(evaluate({ unit: active, tracker: initialTracker(), nowMs: WITHIN_GRACE_MS })).toBe(
      'starting',
    );
  });

  test('running only once the tenant has accepted a connection', () => {
    const tracker = probe({ tracker: initialTracker(), healthy: true });
    expect(evaluate({ unit: active, tracker, nowMs: WITHIN_GRACE_MS })).toBe('running');
  });

  test('failures inside the grace period do not fail the instance', () => {
    expect(evaluate({ unit: active, tracker: failing(10), nowMs: WITHIN_GRACE_MS })).toBe(
      'starting',
    );
  });

  test('never healthy past the grace period is failed', () => {
    expect(evaluate({ unit: active, tracker: failing(UNHEALTHY_RUN), nowMs: PAST_GRACE_MS })).toBe(
      'failed',
    );
  });

  test('healthy once and then failing is unhealthy, not failed', () => {
    expect(
      evaluate({ unit: active, tracker: healthyThen(UNHEALTHY_RUN), nowMs: PAST_GRACE_MS }),
    ).toBe('unhealthy');
  });

  test('a failure run below the threshold leaves a healthy instance running', () => {
    expect(evaluate({ unit: active, tracker: healthyThen(1), nowMs: PAST_GRACE_MS })).toBe(
      'running',
    );
  });
});

describe('what the VM itself is doing', () => {
  test('a VM that exited unasked is failed and stays failed', () => {
    expect(evaluate({ unit: exited, tracker: healthyThen(0), nowMs: PAST_GRACE_MS })).toBe(
      'failed',
    );
  });

  test('a crashed unit is failed regardless of the last probe', () => {
    const tracker = probe({ tracker: initialTracker(), healthy: true });
    expect(evaluate({ unit: crashed, tracker, nowMs: WITHIN_GRACE_MS })).toBe('failed');
  });

  test('a VM stopped on request is stopped, not failed', () => {
    expect(
      evaluate({
        unit: exited,
        tracker: initialTracker(),
        nowMs: PAST_GRACE_MS,
        stopRequested: true,
      }),
    ).toBe('stopped');
  });

  test('a stop in progress is reported as stopping while the unit is still up', () => {
    expect(
      evaluate({
        unit: active,
        tracker: probe({ tracker: initialTracker(), healthy: true }),
        nowMs: PAST_GRACE_MS,
        stopRequested: true,
      }),
    ).toBe('stopping');
  });

  test('an instance that was never started is pending', () => {
    expect(
      evaluateInstanceState({
        unit: absent,
        tracker: initialTracker(),
        healthCheck: check(),
        desiredRunning: true,
        stopRequested: false,
        nowMs: STARTED_AT_MS,
      }),
    ).toBe('pending');
  });

  test('an instance the control plane wants stopped reads as stopped once the unit is down', () => {
    expect(
      evaluate({
        unit: absent,
        tracker: initialTracker(),
        nowMs: PAST_GRACE_MS,
        desiredRunning: false,
      }),
    ).toBe('stopped');
  });
});

describe('thresholds are honoured', () => {
  test('healthyThreshold above one keeps a single success in starting', () => {
    const tracker = probe({
      tracker: initialTracker(),
      healthy: true,
      healthyThreshold: TWO_SUCCESSES,
    });
    expect(
      evaluate({
        unit: active,
        tracker,
        nowMs: WITHIN_GRACE_MS,
        healthCheck: check({ healthyThreshold: TWO_SUCCESSES }),
      }),
    ).toBe('starting');
  });

  test('two successes reach running once the threshold is two', () => {
    let tracker = probe({
      tracker: initialTracker(),
      healthy: true,
      healthyThreshold: TWO_SUCCESSES,
    });
    tracker = probe({ tracker, healthy: true, healthyThreshold: TWO_SUCCESSES });
    expect(
      evaluate({
        unit: active,
        tracker,
        nowMs: WITHIN_GRACE_MS,
        healthCheck: check({ healthyThreshold: TWO_SUCCESSES }),
      }),
    ).toBe('running');
  });
});
