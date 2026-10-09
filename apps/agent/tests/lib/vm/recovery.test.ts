import { describe, expect, test } from 'bun:test';
import { readInstanceRecords } from '#lib/report/instance-record.ts';
import type { VmFailure } from '#lib/vm/failure.ts';
import { consoleFailure } from '#lib/vm/failure.ts';
import {
  afterVmFailure,
  afterVmHealth,
  beginVmRetry,
  VM_RECOVERY_POLICY,
  type VmRecovery,
} from '#lib/vm/recovery.ts';
import { instanceRecord } from '#tests/support/fixtures.ts';

const FAILURE: VmFailure = {
  kind: 'unexpected-exit',
  message: 'the microVM stopped',
  retryable: true,
};
const FIRST_RETRY_DELAY_MS = 1_000;
const SECOND_RETRY_DELAY_MS = 2_000;
const THIRD_RETRY_DELAY_MS = 4_000;
const RETRY_DELAYS_MS = [FIRST_RETRY_DELAY_MS, SECOND_RETRY_DELAY_MS, THIRD_RETRY_DELAY_MS];
const EXHAUSTED_ATTEMPTS = 3;
const TENANT_FAILURE =
  '[nibrun] the tenant used its 5 restarts without staying up; shutting the guest down';
const KVM_FAILURE =
  '2026-10-08T16:31:45.422502 [anonymous-instance:vcpu 0] Received KVM_EXIT_FAIL_ENTRY signal: 7 on cpu 1';

describe('VM failure diagnostics', () => {
  test('KVM failure takes priority over a stale guest verdict and carries reason and CPU', () => {
    expect(consoleFailure([TENANT_FAILURE, KVM_FAILURE, 'Vmm is stopping.'].join('\n'))).toEqual({
      kind: 'kvm',
      message: 'the microVM could not enter KVM, reason 7 on CPU 1',
      retryable: true,
      kvmReason: 7,
      cpu: 1,
    });
  });

  test('informational guest startup logs are not an explanation for a VM exit', () => {
    expect(consoleFailure('[nibrun] control channel listening')).toBeUndefined();
  });

  test('guest mount failures remain visible without accepting informational startup logs', () => {
    expect(
      consoleFailure('[nibrun] could not mount /dev/vdc on /app/data: Input/output error')?.message,
    ).toBe('could not mount /dev/vdc on /app/data: Input/output error');
  });

  test('shutdown cleanup errors cannot turn an exhausted tenant budget into a retry', () => {
    expect(
      consoleFailure(
        [TENANT_FAILURE, '[nibrun] could not unmount /app/data: Device or resource busy'].join(
          '\n',
        ),
      )?.retryable,
    ).toBe(false);
  });

  test('exhausted tenant process retries are terminal rather than multiplied by VM retries', () => {
    expect(consoleFailure(TENANT_FAILURE)?.retryable).toBe(false);
  });
});

describe('bounded VM recovery', () => {
  test('three retries follow increasing backoff, then the original failure is retained', () => {
    let recovery: VmRecovery | undefined;
    for (const [attempt, delayMs] of RETRY_DELAYS_MS.entries()) {
      recovery = afterVmFailure({ recovery, failure: FAILURE, nowMs: 0 });
      expect(recovery.nextAttemptAtMs).toBe(delayMs);
      recovery = beginVmRetry(recovery);
      expect(recovery.attempts).toBe(attempt + 1);
    }
    recovery = afterVmFailure({ recovery, failure: FAILURE, nowMs: 1_000_000 });
    expect(recovery.nextAttemptAtMs).toBeUndefined();
    expect(recovery.failure).toEqual(FAILURE);
    expect(recovery.attempts).toBe(VM_RECOVERY_POLICY.maxRetries);
  });

  test('time spent down and persistence do not replenish the retry budget', () => {
    const record = instanceRecord({ recovery: { attempts: 3, failure: FAILURE } });
    const restored = readInstanceRecords(JSON.parse(JSON.stringify([record])))[0];
    expect(
      afterVmFailure({ recovery: restored?.recovery, failure: FAILURE, nowMs: 1_000_000 })
        .nextAttemptAtMs,
    ).toBeUndefined();
  });

  test('only a continuous minute of health resets the budget', () => {
    let recovery: VmRecovery | undefined = { attempts: 3, failure: FAILURE };
    recovery = afterVmHealth({ recovery, healthy: true, nowMs: 0 });
    recovery = afterVmHealth({ recovery, healthy: true, nowMs: 59_999 });
    expect(recovery?.attempts).toBe(EXHAUSTED_ATTEMPTS);
    recovery = afterVmHealth({ recovery, healthy: false, nowMs: 60_000 });
    recovery = afterVmHealth({ recovery, healthy: true, nowMs: 60_001 });
    expect(afterVmHealth({ recovery, healthy: true, nowMs: 120_000 })?.attempts).toBe(
      EXHAUSTED_ATTEMPTS,
    );
    expect(afterVmHealth({ recovery, healthy: true, nowMs: 120_001 })).toBeUndefined();
  });

  test('a known tenant crash loop never receives a VM retry', () => {
    const failure = consoleFailure(TENANT_FAILURE);
    expect(failure).toBeDefined();
    if (failure) {
      expect(
        afterVmFailure({ recovery: undefined, failure, nowMs: 0 }).nextAttemptAtMs,
      ).toBeUndefined();
    }
  });
});
