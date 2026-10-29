import { expect, test } from 'bun:test';
import { HostReportedStateSchema, isValidMessage } from '@repo/protocol';
import { Effect } from 'effect';
import { nibrunnerReportedState } from '#lib/nibrunner/reported-state.ts';
import { ARTIFACT_DIGEST } from '#tests/support/artifacts.ts';
import {
  APP_ID,
  DEPLOYMENT_ID,
  FIRST_HOST_PORT,
  HOST_ID,
  OBSERVED_AT,
  VOLUME_ID,
  VOLUME_SIZE_BYTES,
} from '#tests/support/fixtures.ts';
import { runScoped } from '#tests/support/run.ts';

const REPORT_MAX_AGE_MS = 30_000;
const NOW_MS = Date.parse(OBSERVED_AT);

function engineReport() {
  return {
    hostId: HOST_ID,
    reportedAt: OBSERVED_AT,
    state: 'ready',
    capacity: { vcpuCount: 4, memoryMib: 8192, cacheBytes: 1000 },
    allocatable: { vcpuCount: 3, memoryMib: 7936, cacheBytes: 900 },
    versions: { agent: '2026.10.7', guestImage: 'guest', firecracker: 'v1.16.1', zerofs: 'none' },
    volumes: [{ volumeId: VOLUME_ID, appId: APP_ID, state: 'ready', sizeBytes: VOLUME_SIZE_BYTES }],
    instances: [
      {
        appId: APP_ID,
        deploymentId: DEPLOYMENT_ID,
        state: 'running',
        hostPort: FIRST_HOST_PORT,
        layerDigests: [ARTIFACT_DIGEST],
        restartCount: 0,
        startedAt: OBSERVED_AT,
        convergedAt: OBSERVED_AT,
      },
    ],
    checkpoints: [],
    exports: [],
    acceptedDigest: ARTIFACT_DIGEST,
    acceptedRevision: 'desired-1',
    message: null,
  };
}

function context(value: unknown) {
  return {
    hostId: HOST_ID,
    desiredDigest: ARTIFACT_DIGEST,
    nowMs: NOW_MS,
    maxAgeMs: REPORT_MAX_AGE_MS,
    admissionState: 'draining' as const,
    value,
  };
}

test('engine observations become a valid API report without leaking engine-only metadata', async () => {
  const raw = engineReport();
  const original = structuredClone(raw);
  const report = await runScoped(nibrunnerReportedState(context(raw)));
  expect(isValidMessage({ schema: HostReportedStateSchema, value: report })).toBe(true);
  expect(report.state).toBe('draining');
  expect(report.instances[0]?.artifactDigest).toBe(ARTIFACT_DIGEST);
  expect(report.instances[0]).not.toHaveProperty('layerDigests');
  expect(report.instances[0]).not.toHaveProperty('convergedAt');
  expect(report.instances[0]).not.toHaveProperty('lastHealthyAt');
  expect(report).not.toHaveProperty('message');
  expect(report).not.toHaveProperty('acceptedRevision');
  expect(raw).toEqual(original);
});

test('placement is ready only after the current desired digest is accepted', async () => {
  const input = { ...context(engineReport()), admissionState: 'ready' as const };
  expect((await runScoped(nibrunnerReportedState(input))).state).toBe('ready');
  const previous = { ...engineReport(), acceptedDigest: 'different' };
  expect((await runScoped(nibrunnerReportedState({ ...input, value: previous }))).state).toBe(
    'registering',
  );
  expect(
    (
      await runScoped(
        nibrunnerReportedState({ ...input, value: { ...engineReport(), state: 'draining' } }),
      )
    ).state,
  ).toBe('draining');
});

test('stale and far-future reports cannot keep placement ready', async () => {
  const input = { ...context(engineReport()), admissionState: 'ready' as const };
  const outsideWindow = REPORT_MAX_AGE_MS + 1;
  expect(
    (await runScoped(nibrunnerReportedState({ ...input, nowMs: NOW_MS + outsideWindow }))).state,
  ).toBe('unreachable');
  expect(
    (await runScoped(nibrunnerReportedState({ ...input, nowMs: NOW_MS - outsideWindow }))).state,
  ).toBe('unreachable');
});

test('a foreign host report is rejected rather than relabeled as the current host', async () => {
  const error = await runScoped(
    Effect.flip(nibrunnerReportedState(context({ ...engineReport(), hostId: 'another-host' }))),
  );
  expect(error._tag).toBe('ProtocolMismatch');
});

test('missing layers do not invent an artifact and multiple layers are refused', async () => {
  const raw = engineReport();
  raw.instances[0]!.layerDigests = [];
  expect(
    (await runScoped(nibrunnerReportedState(context(raw)))).instances[0]?.artifactDigest,
  ).toBeUndefined();
  raw.instances[0]!.layerDigests = [ARTIFACT_DIGEST, ARTIFACT_DIGEST];
  expect((await runScoped(Effect.flip(nibrunnerReportedState(context(raw)))))._tag).toBe(
    'ProtocolMismatch',
  );
});

test('invalid observations fail validation without including offending values', async () => {
  const raw = { ...engineReport(), capacity: { memoryMib: 'tenant-secret-value' } };
  const error = await runScoped(Effect.flip(nibrunnerReportedState(context(raw))));
  expect(error._tag).toBe('ProtocolMismatch');
  expect(JSON.stringify(error.issues)).not.toContain('tenant-secret-value');
});
