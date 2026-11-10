import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { repoRoot } from '#shared/paths.ts';

const CHECKER = join(repoRoot, 'infra/nibrunner-host/deploy/assert_empty_host.py');
const RESOURCES = ['instances', 'volumes', 'checkpoints', 'exports'];

async function checkHost({
  desiredOverrides,
  reportedOverrides,
}: {
  desiredOverrides: Record<string, unknown>;
  reportedOverrides: Record<string, unknown>;
}) {
  const directory = await mkdtemp(join(tmpdir(), 'nibrunner-empty-host-'));
  try {
    const resources = { instances: [], volumes: [], checkpoints: [], exports: [] };
    const desired = `${JSON.stringify({ ...resources, ...desiredOverrides })}\n`;
    const report = {
      ...resources,
      acceptedDigest: new Bun.CryptoHasher('sha256').update(desired).digest('hex'),
      reportedAt: new Date().toISOString(),
      state: 'ready',
      ...reportedOverrides,
    };
    await Bun.write(join(directory, 'desired.json'), desired);
    await Bun.write(join(directory, 'reported.json'), JSON.stringify(report));
    return await $`python3 ${CHECKER} ${directory}`.quiet().nothrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('a fresh acknowledged empty host can be reinitialized', async () => {
  expect((await checkHost({ desiredOverrides: {}, reportedOverrides: {} })).exitCode).toBe(0);
});

test.each(RESOURCES)('a desired %s resource prevents reinitialization', async (resource) => {
  const result = await checkHost({ desiredOverrides: { [resource]: [{}] }, reportedOverrides: {} });
  expect(result.exitCode).not.toBe(0);
});

test.each(RESOURCES)('a reported %s resource prevents reinitialization', async (resource) => {
  const result = await checkHost({ desiredOverrides: {}, reportedOverrides: { [resource]: [{}] } });
  expect(result.exitCode).not.toBe(0);
});

test('a stale report cannot establish that a host is empty', async () => {
  const result = await checkHost({
    desiredOverrides: {},
    reportedOverrides: { reportedAt: new Date(0).toISOString() },
  });
  expect(result.exitCode).not.toBe(0);
});

test('an unacknowledged empty document cannot authorize reinitialization', async () => {
  const result = await checkHost({
    desiredOverrides: {},
    reportedOverrides: { acceptedDigest: null },
  });
  expect(result.exitCode).not.toBe(0);
});

test('missing resource information is not an empty host', async () => {
  const result = await checkHost({ desiredOverrides: {}, reportedOverrides: { instances: null } });
  expect(result.exitCode).not.toBe(0);
});
