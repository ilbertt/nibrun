import type {
  AppId,
  ExportId,
  InstanceId,
  ReportedCheckpoint,
  ReportedExport,
  ReportedVolume,
  VolumeId,
} from '@repo/protocol';
import { Effect, Ref } from 'effect';
import type { InstanceRecord } from '#lib/report/instance-record.ts';

const NO_GENERATION = 0;

export type AgentSnapshot = {
  readonly records: ReadonlyMap<InstanceId, InstanceRecord>;
  readonly exportReports: ReadonlyMap<ExportId, ReportedExport>;
  readonly nextProbeAtMs: ReadonlyMap<InstanceId, number>;
  readonly volumeReports: readonly ReportedVolume[];
  readonly checkpointReports: readonly ReportedCheckpoint[];
  readonly observedGeneration: number;
  readonly converged: boolean;
  /** Whether the last reconcile deferred something, and so whether re-running it would do anything. */
  readonly deferredWork: boolean;
  /** Whether this host's isolation ruleset is in the kernel. A tenant is not started without it. */
  readonly isolated: boolean;
};

const EMPTY: AgentSnapshot = {
  records: new Map(),
  exportReports: new Map(),
  nextProbeAtMs: new Map(),
  volumeReports: [],
  checkpointReports: [],
  observedGeneration: NO_GENERATION,
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
          records: new Map(current.records).set(record.instanceId, record),
        })),

      updateRecord: ({
        instanceId,
        change,
      }: {
        instanceId: InstanceId;
        change: (record: InstanceRecord) => InstanceRecord;
      }) =>
        modify((current) => {
          const record = current.records.get(instanceId);
          return record
            ? { ...current, records: new Map(current.records).set(instanceId, change(record)) }
            : current;
        }),

      dropRecord: (instanceId: InstanceId) =>
        modify((current) => {
          const remaining = new Map(current.records);
          remaining.delete(instanceId);
          return { ...current, records: remaining };
        }),

      appIdByVolume: Effect.map(
        records,
        (all) => new Map<VolumeId, AppId>(all.map((record) => [record.volumeId, record.appId])),
      ),
    };
  }),
}) {}
