import {
  type HostId,
  type HostReportedState,
  HostReportedStateSchema,
  type HostState,
  parseMessage,
  type Sha256Digest,
} from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { NibrunnerReportMismatch } from '#lib/nibrunner/failure.ts';
import type { HostReportedState as NibrunnerReport } from '#lib/nibrunner/reported.gen.ts';
import { decode } from '#lib/protocol.ts';

type ReportContext = {
  hostId: HostId;
  desiredDigest: Sha256Digest;
  nowMs: number;
  maxAgeMs: number;
  admissionState: Extract<HostState, 'ready' | 'draining'>;
  value: NibrunnerReport;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedInstance(value: NibrunnerReport['instances'][number]) {
  if (!isRecord(value)) {
    return value;
  }
  const layers = value.layerDigests;
  if (layers !== undefined && (!Array.isArray(layers) || layers.length > 1)) {
    throw new NibrunnerReportMismatch({ reason: 'does not describe a single executable layer' });
  }
  return { ...value, artifactDigest: Array.isArray(layers) ? layers[0] : undefined };
}

function normalizedReport(value: NibrunnerReport) {
  if (!isRecord(value) || !Array.isArray(value.instances)) {
    return value;
  }
  return { ...value, instances: value.instances.map(normalizedInstance) };
}

function omitNullProperties(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(omitNullProperties);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(function isPresent([, property]) {
        return property !== null;
      })
      .map(function normalizeEntry([key, property]) {
        return [key, omitNullProperties(property)];
      }),
  );
}

function reportedHostState({
  report,
  context,
}: {
  report: HostReportedState;
  context: ReportContext;
}): HostState {
  const ageMs = context.nowMs - Date.parse(report.reportedAt);
  if (!Number.isFinite(ageMs) || Math.abs(ageMs) > context.maxAgeMs) {
    return 'unreachable';
  }
  if (report.state === 'ready' && context.value.acceptedDigest !== context.desiredDigest) {
    return 'registering';
  }
  return report.state === 'ready' ? context.admissionState : report.state;
}

export function nibrunnerReportedState(context: ReportContext) {
  return decode(function parseReport() {
    const report = parseMessage({
      schema: HostReportedStateSchema,
      value: Value.Clean(
        HostReportedStateSchema,
        omitNullProperties(normalizedReport(context.value)),
      ),
    });
    if (report.hostId !== context.hostId) {
      throw new NibrunnerReportMismatch({ reason: 'belongs to a different host' });
    }
    return { ...report, state: reportedHostState({ report, context }) };
  });
}
