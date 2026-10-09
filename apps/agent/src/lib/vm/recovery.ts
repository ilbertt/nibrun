import { backoffDelayMs } from '#lib/backoff.ts';
import { isVmFailure, type VmFailure } from '#lib/vm/failure.ts';

export const VM_RECOVERY_POLICY = Object.freeze({
  maxRetries: 3,
  initialBackoffMs: 1_000,
  maxBackoffMs: 4_000,
  backoffFactor: 2,
  healthyResetMs: 60_000,
});

export type VmRecovery = {
  readonly attempts: number;
  readonly nextAttemptAtMs?: number;
  readonly healthySinceMs?: number;
  readonly failure?: VmFailure;
};

export function afterVmFailure({
  recovery,
  failure,
  nowMs,
}: {
  recovery: VmRecovery | undefined;
  failure: VmFailure;
  nowMs: number;
}): VmRecovery {
  const attempts = recovery?.attempts ?? 0;
  const retry = failure.retryable && attempts < VM_RECOVERY_POLICY.maxRetries;
  return {
    attempts,
    failure,
    ...(retry
      ? {
          nextAttemptAtMs:
            nowMs + backoffDelayMs({ attempt: attempts + 1, policy: VM_RECOVERY_POLICY }),
        }
      : {}),
  };
}

export function afterVmHealth({
  recovery,
  healthy,
  nowMs,
}: {
  recovery: VmRecovery | undefined;
  healthy: boolean;
  nowMs: number;
}): VmRecovery | undefined {
  if (!recovery) {
    return undefined;
  }
  if (!healthy) {
    return { ...recovery, healthySinceMs: undefined };
  }
  const healthySinceMs = recovery.healthySinceMs ?? nowMs;
  return nowMs - healthySinceMs >= VM_RECOVERY_POLICY.healthyResetMs
    ? undefined
    : { ...recovery, healthySinceMs };
}

export function beginVmRetry(recovery: VmRecovery): VmRecovery {
  return { attempts: recovery.attempts + 1, failure: recovery.failure };
}

export function isVmRecovery(value: unknown): value is VmRecovery {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const recovery = value as VmRecovery;
  return (
    Number.isInteger(recovery.attempts) &&
    recovery.attempts >= 0 &&
    (recovery.nextAttemptAtMs === undefined || Number.isFinite(recovery.nextAttemptAtMs)) &&
    (recovery.healthySinceMs === undefined || Number.isFinite(recovery.healthySinceMs)) &&
    (recovery.failure === undefined || isVmFailure(recovery.failure))
  );
}
