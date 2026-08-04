import type {
  AppId,
  ExportId,
  InstanceId,
  ReportedCheckpoint,
  ReportedExport,
  ReportedVolume,
  VolumeId,
} from '@repo/protocol';
import { Context, Effect, Layer, Ref } from 'effect';
import type { InstanceRecord } from '#report/instance-record.ts';

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

export class AgentState extends Context.Tag('AgentState')<AgentState, Ref.Ref<AgentSnapshot>>() {}

export const layer = Layer.effect(AgentState, Ref.make(EMPTY));

export const snapshot = Effect.flatMap(AgentState, Ref.get);

export const modify = (change: (current: AgentSnapshot) => AgentSnapshot) =>
  Effect.flatMap(AgentState, (state) => Ref.update(state, change));

export const records = Effect.map(snapshot, (current) => [...current.records.values()]);

export const putRecord = (record: InstanceRecord) =>
  modify((current) => ({
    ...current,
    records: new Map(current.records).set(record.instanceId, record),
  }));

export const updateRecord = ({
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
  });

export const dropRecord = (instanceId: InstanceId) =>
  modify((current) => {
    const records_ = new Map(current.records);
    records_.delete(instanceId);
    return { ...current, records: records_ };
  });

export const appIdByVolume = Effect.map(
  records,
  (all) => new Map<VolumeId, AppId>(all.map((record) => [record.volumeId, record.appId])),
);

/** Rebuilt from what a reconcile found rather than added to, so what just happened to a volume wins. */
export function mergeVolumeReports({
  existing,
  updates,
}: {
  existing: readonly ReportedVolume[];
  updates: readonly ReportedVolume[];
}): ReportedVolume[] {
  const merged = new Map(existing.map((report) => [report.volumeId, report] as const));
  for (const report of updates) {
    merged.set(report.volumeId, report);
  }
  return [...merged.values()];
}
