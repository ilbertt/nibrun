import { describe, expect, test } from 'bun:test';
import { DEFAULT_HEALTH_CHECK, DEFAULT_HTTP_PORT, type HealthCheck } from '@repo/protocol';
import {
  applyProbe,
  describeInstanceFailure,
  evaluateInstanceState,
  initialTracker,
  nextProbeDelayMs,
  STARTUP_PROBE_INTERVAL_MS,
} from '#lib/health/state.ts';
import type { UnitStatus } from '#lib/vm/unit-status.ts';
import { OBSERVED_AT } from '#tests/support/fixtures.ts';

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

/**
 * The interval is what stands between a binary starting to listen and the deploy that is waiting
 * on it being called done, so the boot and the liveness cadence are deliberately not the same
 * number — and the point of the grace bound is that a slow starter is still failed on the old one.
 */
describe('how soon a tenant is asked again', () => {
  function delay({
    tracker,
    nowMs,
    healthCheck = check(),
  }: {
    tracker: Tracker;
    nowMs: number;
    healthCheck?: HealthCheck;
  }) {
    return nextProbeDelayMs({ tracker, healthCheck, startedAtMs: STARTED_AT_MS, nowMs });
  }

  test('a tenant that has never answered is asked on the startup grid', () => {
    expect(delay({ tracker: initialTracker(), nowMs: WITHIN_GRACE_MS })).toBe(
      STARTUP_PROBE_INTERVAL_MS,
    );
  });

  test('one that has answered falls back to the liveness interval', () => {
    expect(delay({ tracker: healthyThen(0), nowMs: WITHIN_GRACE_MS })).toBe(
      DEFAULT_HEALTH_CHECK.intervalMs,
    );
  });

  test('past the grace period the startup grid is over, so a slow starter fails as it always did', () => {
    expect(delay({ tracker: initialTracker(), nowMs: PAST_GRACE_MS })).toBe(
      DEFAULT_HEALTH_CHECK.intervalMs,
    );
  });

  test('an interval configured below the startup grid is not slowed to it', () => {
    const intervalMs = STARTUP_PROBE_INTERVAL_MS - 1;
    expect(
      delay({
        tracker: initialTracker(),
        nowMs: WITHIN_GRACE_MS,
        healthCheck: check({ intervalMs }),
      }),
    ).toBe(intervalMs);
  });
});

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

  test('a start still being staged is pending, though the replaced unit is still loaded', () => {
    expect(
      evaluateInstanceState({
        unit: exited,
        tracker: initialTracker(),
        healthCheck: check(),
        desiredRunning: true,
        stopRequested: false,
        nowMs: STARTED_AT_MS,
      }),
    ).toBe('pending');
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

describe('a failure accounts for itself', () => {
  function failure({ unit, tracker }: { unit: UnitStatus; tracker: Tracker }): string {
    return describeInstanceFailure({
      unit,
      tracker,
      healthCheck: check(),
      httpPort: DEFAULT_HTTP_PORT,
    });
  }

  test('a VM that stopped names the code it stopped with', () => {
    expect(failure({ unit: exited, tracker: initialTracker() })).toBe(
      'the microVM stopped without being asked to, exit code 0',
    );
  });

  // systemd has nothing to report for a unit it has already been asked to forget, and an owner
  // told only that a number is missing learns less than one told the VM stopped.
  test('and one whose code systemd no longer has still says what happened', () => {
    expect(failure({ unit: { ...crashed, exitCode: undefined }, tracker: initialTracker() })).toBe(
      'the microVM stopped without being asked to',
    );
  });

  // The exit code beside a stopped VM is Firecracker's, and a guest that powered itself off
  // deliberately leaves it 0 — so an owner reading it is told the failure succeeded.
  test('a guest that said why it stopped is quoted rather than the VMM exit code', () => {
    expect(
      describeInstanceFailure({
        unit: exited,
        tracker: initialTracker(),
        healthCheck: check(),
        httpPort: DEFAULT_HTTP_PORT,
        guestVerdict: 'the tenant used its 5 restarts without staying up; shutting the guest down',
      }),
    ).toBe('the tenant used its 5 restarts without staying up; shutting the guest down');
  });

  // A VM still up never stopped, so there is no console verdict to prefer over the one branch
  // that is about not being answered at all.
  test('a verdict does not displace the account of a guest nothing could reach', () => {
    expect(
      describeInstanceFailure({
        unit: active,
        tracker: { ...initialTracker(), consecutiveFailures: UNHEALTHY_RUN },
        healthCheck: check(),
        httpPort: DEFAULT_HTTP_PORT,
        guestVerdict: 'the tenant has stopped; shutting the guest down',
      }),
    ).toBe(
      `nothing answered on port ${DEFAULT_HTTP_PORT} inside the guest: ${UNHEALTHY_RUN} health probes failed after the ${GRACE_MS}ms grace period`,
    );
  });

  test('a guest nobody could reach names the port and what was spent trying', () => {
    const tracker = { ...initialTracker(), consecutiveFailures: UNHEALTHY_RUN };

    expect(failure({ unit: active, tracker })).toBe(
      `nothing answered on port ${DEFAULT_HTTP_PORT} inside the guest: ${UNHEALTHY_RUN} health probes failed after the ${GRACE_MS}ms grace period`,
    );
  });
});
