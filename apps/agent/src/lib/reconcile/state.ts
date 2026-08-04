import type { AppId, InstanceId, ReportedVolume, VolumeId } from '@repo/protocol';
import { Effect, Ref } from 'effect';
import type { InstanceRecord } from '#lib/report/instance-record.ts';
import { type AgentSnapshot, AgentState } from '#services/agent-state.service.ts';

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
