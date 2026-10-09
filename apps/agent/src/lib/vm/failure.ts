export type VmFailure = {
  readonly kind: 'kvm' | 'guest' | 'unexpected-exit' | 'boot' | 'health';
  readonly message: string;
  readonly retryable: boolean;
  readonly kvmReason?: number;
  readonly cpu?: number;
};

export const GUEST_LOG_PREFIX = '[nibrun] ';
const KVM_ENTRY_FAILURE = /Received KVM_EXIT_FAIL_ENTRY signal: (\d+) on cpu (\d+)/;
const TENANT_BUDGET_EXHAUSTED =
  /^the tenant used its \d+ restarts without staying up; shutting the guest down$/;
const GUEST_STARTUP_FAILURE = /^(?:could not|instance.env|\/dev\/\S+ never appeared)/;

export function consoleFailure(output: string): VmFailure | undefined {
  let guestFailure: VmFailure | undefined;
  let kvmFailure: VmFailure | undefined;
  let startupFailure: VmFailure | undefined;
  for (const line of output.split('\n')) {
    const match = KVM_ENTRY_FAILURE.exec(line);
    if (match && !line.trim().startsWith(GUEST_LOG_PREFIX)) {
      const kvmReason = Number(match[1]);
      const cpu = Number(match[2]);
      kvmFailure = {
        kind: 'kvm',
        message: `the microVM could not enter KVM, reason ${kvmReason} on CPU ${cpu}`,
        retryable: true,
        kvmReason,
        cpu,
      };
    }
    const message = line.trim().startsWith(GUEST_LOG_PREFIX)
      ? line.trim().slice(GUEST_LOG_PREFIX.length)
      : undefined;
    if (message?.endsWith('; shutting the guest down')) {
      guestFailure = {
        kind: 'guest',
        message,
        retryable: !TENANT_BUDGET_EXHAUSTED.test(message),
      };
    }
    if (message && GUEST_STARTUP_FAILURE.test(message)) {
      startupFailure = { kind: 'guest', message, retryable: true };
    }
  }
  return kvmFailure ?? guestFailure ?? startupFailure;
}

export function isVmFailure(value: unknown): value is VmFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string' &&
    'retryable' in value &&
    typeof value.retryable === 'boolean' &&
    'kind' in value &&
    typeof value.kind === 'string'
  );
}
