import type {
  ExportId,
  InstanceId,
  ReportedCheckpoint,
  ReportedExport,
  ReportedVolume,
} from '@repo/protocol';
import { Context, Layer, Ref } from 'effect';
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
