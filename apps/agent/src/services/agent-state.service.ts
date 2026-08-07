import type {
  AppId,
  ExportId,
  ReportedCheckpoint,
  ReportedExport,
  ReportedVolume,
  VolumeId,
} from '@repo/protocol';
import { Effect, Ref } from 'effect';
import type { InstanceRecord } from '#lib/report/instance-record.ts';

export type AgentSnapshot = {
  readonly records: ReadonlyMap<AppId, InstanceRecord>;
  readonly exportReports: ReadonlyMap<ExportId, ReportedExport>;
  /**
   * Volumes this host removed, held until desired state stops naming them. A removal leaves
   * nothing behind to observe, so this is the only thing that keeps saying it happened.
   */
  readonly deletedVolumes: ReadonlyMap<VolumeId, ReportedVolume>;
  readonly nextProbeAtMs: ReadonlyMap<AppId, number>;
  readonly volumeReports: readonly ReportedVolume[];
  readonly checkpointReports: readonly ReportedCheckpoint[];
  readonly converged: boolean;
  /** Whether the last reconcile deferred something, and so whether re-running it would do anything. */
  readonly deferredWork: boolean;
  /** Whether this host's isolation ruleset is in the kernel. A tenant is not started without it. */
  readonly isolated: boolean;
};

const EMPTY: AgentSnapshot = {
  records: new Map(),
  exportReports: new Map(),
  deletedVolumes: new Map(),
  nextProbeAtMs: new Map(),
  volumeReports: [],
  checkpointReports: [],
  converged: false,
  deferredWork: false,
  isolated: false,
};

/** The Ref never leaves: every read and every transition is a member, so there is one writer. */
export class AgentState extends Effect.Service<AgentState>()('AgentState', {
  accessors: true,
  effect: Effect.gen(function* () {
    const state = yield* Ref.make(EMPTY);

    const modify = (change: (current: AgentSnapshot) => AgentSnapshot) => Ref.update(state, change);
    const snapshot = Ref.get(state);
    const records = Effect.map(snapshot, (current) => [...current.records.values()]);

    return {
      snapshot,
      modify,
      records,

      putRecord: (record: InstanceRecord) =>
        modify((current) => ({
          ...current,
          records: new Map(current.records).set(record.appId, record),
        })),

      updateRecord: ({
        appId,
        change,
      }: {
        appId: AppId;
        change: (record: InstanceRecord) => InstanceRecord;
      }) =>
        modify((current) => {
          const record = current.records.get(appId);
          return record
            ? { ...current, records: new Map(current.records).set(appId, change(record)) }
            : current;
        }),

      dropRecord: (appId: AppId) =>
        modify((current) => {
          const remaining = new Map(current.records);
          remaining.delete(appId);
          return { ...current, records: remaining };
        }),

      rememberDeletedVolume: (report: ReportedVolume) =>
        modify((current) => ({
          ...current,
          deletedVolumes: new Map(current.deletedVolumes).set(report.volumeId, report),
        })),

      /** Once desired state stops naming it, the control plane has taken the removal in. */
      forgetDeletedVolumes: (keep: ReadonlySet<VolumeId>) =>
        modify((current) => ({
          ...current,
          deletedVolumes: new Map(
            [...current.deletedVolumes].filter(([volumeId]) => keep.has(volumeId)),
          ),
        })),
    };
  }),
}) {}
