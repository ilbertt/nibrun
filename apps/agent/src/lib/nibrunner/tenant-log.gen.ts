/**
 * Generated from https://raw.githubusercontent.com/ilbertt/nibrunner/v2026.11.5/crates/protocol/schema/tenant-log.schema.json
 * Run bun run --filter @repo/internal-scripts generate-nibrunner-types; do not edit.
 */

export type TenantLogEvent = {
  appId: AppId;
  deploymentId: DeploymentId;
  observedAt: Timestamp;
  sequence: number;
  sourceId: string;
  [k: string]: unknown;
} & (
  | {
      kind: 'data';
      stream: TenantLogStream;
      text: string;
      [k: string]: unknown;
    }
  | {
      jobId: string;
      kind: 'cron-data';
      runId: string;
      stream: TenantLogStream;
      text: string;
      [k: string]: unknown;
    }
  | {
      droppedBytes: number;
      kind: 'gap';
      [k: string]: unknown;
    }
  | (TenantRestart & {
      kind: 'restart';
      [k: string]: unknown;
    })
);
/**
 * an identifier
 */
export type AppId = string;
/**
 * an identifier
 */
export type DeploymentId = string;
/**
 * an ISO 8601 instant with an offset
 */
export type Timestamp = string;
export type TenantLogStream = 'stdout' | 'stderr';
/**
 * How a tenant process ended: the code it exited with, or the signal that killed it.
 */
export type TenantExit =
  | {
      code: number;
    }
  | {
      signal: number;
    };
export type StateMessage = string;

/**
 * One restart of the tenant by the supervisor inside its guest, as the guest reported it. The
 * host never sees the process, so this is the whole of what it knows about why the tenant went
 * down and came back: which of the budget this restart was, how the tenant ended, the sentence
 * the guest printed for it, and how long it waited before starting the tenant again.
 */
export interface TenantRestart {
  /**
   * 1 for the first restart since the tenant last stayed up long enough to earn its budget
   * back, up to `budget`.
   */
  attempt: number;
  backoffMs: number;
  budget: number;
  exit: TenantExit;
  reason: StateMessage;
  [k: string]: unknown;
}
