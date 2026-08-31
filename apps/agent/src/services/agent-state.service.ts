import type {
  AppId,
  ComputeUsage,
  ExportId,
  FilesystemUsage,
  ReportedCheckpoint,
  ReportedExport,
  ReportedVolume,
  VolumeId,
} from '@repo/protocol';
import { Effect, Ref } from 'effect';
import type { MeasuredCompute } from '#lib/filesystem/protocol.ts';
import type { AppTraffic } from '#lib/network/counters.ts';
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
  /**
   * The last reading taken of each volume this host holds a slot for, which is not the same as
   * each volume a guest can currently be asked about: a suspended app keeps its slot, so its last
   * reading is kept too rather than the app going from a number to nothing on being stopped.
   */
  readonly volumeUsage: ReadonlyMap<AppId, FilesystemUsage>;
  /** The same, for what the guest is spending rather than what its filesystem holds. */
  readonly computeUsage: ReadonlyMap<AppId, ComputeUsage>;
  /**
   * The counters the last compute reading was decoded from, which the next one is measured
   * against: a share is a difference over an interval, so the reading is not what produces it.
   * Kept for an app that could not be asked, so a pass that failed widens the interval the next
   * share is over rather than throwing away the only thing it could be compared to.
   */
  readonly computeTicks: ReadonlyMap<AppId, MeasuredCompute>;
  /**
   * The counters the last activity reading was taken from, kept for the same reason the compute
   * ticks are: the next reading is only meaningful against the one before it.
   */
  readonly appTraffic: ReadonlyMap<AppId, AppTraffic>;
  /**
   * When each app was last reached by something that was not this host, which is what decides
   * whether an `on-request` app may sleep.
   */
  readonly lastActiveAtMs: ReadonlyMap<AppId, number>;
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
  volumeUsage: new Map(),
  computeUsage: new Map(),
  computeTicks: new Map(),
  appTraffic: new Map(),
  lastActiveAtMs: new Map(),
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

      /**
       * A request is evidence of use before any counter has seen it. The counters are read on
       * their own cadence and a woken app's is new, which `activityAfter` reads as no evidence
       * rather than as use — so without this a wake would leave the moment that had it sleeping.
       */
      markActive: ({ appId, nowMs }: { appId: AppId; nowMs: number }) =>
        modify((current) => ({
          ...current,
          lastActiveAtMs: new Map(current.lastActiveAtMs).set(appId, nowMs),
        })),

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

      /** A whole pass at once, because what it leaves out is what this host has stopped holding. */
      setUsage: ({
        volumes,
        compute,
        ticks,
      }: {
        volumes: ReadonlyMap<AppId, FilesystemUsage>;
        compute: ReadonlyMap<AppId, ComputeUsage>;
        ticks: ReadonlyMap<AppId, MeasuredCompute>;
      }) =>
        modify((current) => ({
          ...current,
          volumeUsage: new Map(volumes),
          computeUsage: new Map(compute),
          computeTicks: new Map(ticks),
        })),

      /** A whole pass at once, for the reason `setUsage` is: what it leaves out is what went away. */
      setActivity: ({
        traffic,
        lastActiveAtMs,
      }: {
        traffic: ReadonlyMap<AppId, AppTraffic>;
        lastActiveAtMs: ReadonlyMap<AppId, number>;
      }) =>
        modify((current) => ({
          ...current,
          appTraffic: new Map(traffic),
          lastActiveAtMs: new Map(lastActiveAtMs),
        })),

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
