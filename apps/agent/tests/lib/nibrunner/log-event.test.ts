import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import { nibrunnerLogEvent } from '#lib/nibrunner/log-event.ts';
import { APP_ID, HOST_ID } from '#tests/support/fixtures.ts';
import { nibrunnerTenantLog } from '#tests/support/nibrunner.ts';
import { runScoped } from '#tests/support/run.ts';

function decode(value: unknown) {
  return nibrunnerLogEvent({ value, appId: APP_ID, hostId: HOST_ID });
}

test('tenant output retains its identity, timestamp, stream and embedded newlines', async () => {
  const value = { ...nibrunnerTenantLog(), stream: 'stderr', text: 'first\nsecond\n' };
  const original = structuredClone(value);
  expect(await runScoped(decode(value))).toEqual(expect.objectContaining(value));
  expect(value).toEqual(original);
});

test('cron output names its job and run in the log store fields', async () => {
  const value = {
    ...nibrunnerTenantLog(),
    kind: 'cron-data',
    jobId: 'cron-job',
    runId: 'cron-run',
  };
  expect(await runScoped(decode(value))).toMatchObject({
    kind: 'data',
    cronJobId: value.jobId,
    cronRunId: value.runId,
    text: value.text,
  });
});

test('buffer gaps preserve dropped bytes and empty gaps emit nothing', async () => {
  const value = { ...nibrunnerTenantLog(), kind: 'gap', droppedBytes: 123 };
  expect(await runScoped(decode(value))).toMatchObject({ kind: 'gap', droppedBytes: 123 });
  expect(await runScoped(decode({ ...value, droppedBytes: 0 }))).toBeUndefined();
});

test('a tenant restart appears on stderr with its reported reason', async () => {
  const value = { ...nibrunnerTenantLog(), kind: 'restart', reason: 'retrying the tenant' };
  expect(await runScoped(decode(value))).toMatchObject({
    kind: 'data',
    stream: 'stderr',
    text: value.reason,
  });
});

test('foreign apps and malformed records fail without retaining tenant content', async () => {
  for (const value of [
    null,
    { ...nibrunnerTenantLog(), appId: 'another-app' },
    { ...nibrunnerTenantLog(), kind: 'unknown' },
    { ...nibrunnerTenantLog(), sequence: -1 },
    { ...nibrunnerTenantLog(), stream: 'tenant-secret-value' },
    { ...nibrunnerTenantLog(), text: {} },
    { ...nibrunnerTenantLog(), observedAt: 'invalid' },
  ]) {
    const error = await runScoped(Effect.flip(decode(value)));
    expect(error._tag).toBe('InvalidNibrunnerLog');
    expect(JSON.stringify(error)).not.toContain('tenant-secret-value');
  }
});
