import { expect, test } from 'bun:test';
import { FileSystem, HttpClient, HttpClientResponse } from '@effect/platform';
import { Effect, Fiber, HashMap, Layer, Logger, TestClock, TestContext } from 'effect';
import {
  logStorageMemory,
  parseStorageCgroupMemory,
  parseStorageMemoryMetrics,
  parseStorageProcessMemory,
} from '#lib/report/storage-memory.ts';
import { agentConfig } from '#tests/support/config.ts';
import { provided } from '#tests/support/run.ts';

const METRICS = `# TYPE zerofs_jemalloc_allocated_bytes gauge
zerofs_jemalloc_allocated_bytes 2147483648
zerofs_jemalloc_resident_bytes 2.4e9
zerofs_jemalloc_retained_bytes 6000000000
lsm_db_total_mem_size_bytes 1024
zerofs_dedup_inflight_ids 0
unrelated_metric 99
`;

const CGROUP = 'anon 2147483648\nfile 536870912\nkernel 16384\n';
const STATUS = 'VmRSS:\t2097152 kB\nRssAnon:\t2096128 kB\n';

test('captures allocator allocations separately from resident and retained mappings', () => {
  expect(parseStorageMemoryMetrics(METRICS)).toEqual({
    zerofs_jemalloc_allocated_bytes: 2147483648,
    zerofs_jemalloc_resident_bytes: 2400000000,
    zerofs_jemalloc_retained_bytes: 6000000000,
    lsm_db_total_mem_size_bytes: 1024,
    zerofs_dedup_inflight_ids: 0,
  });
});

test('missing or non-finite allocator metrics cannot look like zero memory', () => {
  for (const text of ['', METRICS.replace('2147483648', 'NaN'), METRICS.replace('2.4e9', '+Inf')]) {
    expect(() => parseStorageMemoryMetrics(text)).toThrow();
  }
});

test('separates anonymous cgroup memory from file cache and kernel charges', () => {
  expect(parseStorageCgroupMemory(CGROUP)).toEqual({
    zerofsCgroupAnonBytes: 2147483648,
    zerofsCgroupFileBytes: 536870912,
    zerofsCgroupKernelBytes: 16384,
  });
  expect(() => parseStorageCgroupMemory('anon 1')).toThrow();
});

test('process KiB counters become bytes without conflating RSS and anonymous memory', () => {
  expect(parseStorageProcessMemory(STATUS)).toEqual({
    zerofsProcessRssBytes: 2147483648,
    zerofsProcessAnonBytes: 2146435072,
  });
  expect(() => parseStorageProcessMemory('VmRSS: invalid')).toThrow();
});

function diagnosticReader({
  metrics,
  processes,
  stallHttp,
}: {
  metrics: string;
  processes: string;
  stallHttp: boolean;
}) {
  const entries: Record<string, unknown>[] = [];
  const logger = Logger.replace(
    Logger.defaultLogger,
    Logger.make(({ annotations, message }) =>
      entries.push({ message, ...Object.fromEntries(HashMap.toEntries(annotations)) }),
    ),
  );
  const filesystem = FileSystem.layerNoop({
    readFileString: (path) =>
      Effect.succeed(
        path.endsWith('memory.stat') ? CGROUP : path.endsWith('cgroup.procs') ? processes : STATUS,
      ),
  });
  const http = HttpClient.make((request) =>
    stallHttp
      ? Effect.never
      : Effect.succeed(HttpClientResponse.fromWeb(request, new Response(metrics))),
  );
  const run = provided(
    Layer.mergeAll(
      filesystem,
      Layer.succeed(HttpClient.HttpClient, http),
      agentConfig(),
      logger,
      TestContext.TestContext,
    ),
  );
  return { entries, run };
}

test('diagnostics record process identity and independent sample availability', async () => {
  const reader = diagnosticReader({ metrics: METRICS, processes: '123\n', stallHttp: false });
  await reader.run(logStorageMemory);
  expect(reader.entries[0]).toMatchObject({
    zerofsPid: 123,
    processSampleAvailable: true,
    allocatorSampleAvailable: true,
    cgroupSampleAvailable: true,
    zerofsCgroupFileBytes: 536870912,
    zerofs_jemalloc_allocated_bytes: 2147483648,
  });
});

test('unavailable metrics and ambiguous process identity preserve the remaining diagnostic data', async () => {
  const reader = diagnosticReader({
    metrics: 'unavailable',
    processes: '123\n456\n',
    stallHttp: false,
  });
  await reader.run(logStorageMemory);
  expect(reader.entries[0]).toMatchObject({
    processSampleAvailable: false,
    allocatorSampleAvailable: false,
    cgroupSampleAvailable: true,
    zerofsCgroupAnonBytes: 2147483648,
  });
  expect(reader.entries[0]).not.toHaveProperty('zerofsPid');
  expect(reader.entries[0]).not.toHaveProperty('zerofs_jemalloc_allocated_bytes');
});

test('a hung metrics endpoint times out without stopping the memory loop', async () => {
  const reader = diagnosticReader({ metrics: METRICS, processes: '123\n', stallHttp: true });
  await reader.run(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(logStorageMemory);
      yield* TestClock.adjust('3 seconds');
      yield* Fiber.join(fiber);
    }),
  );
  expect(reader.entries[0]?.message).toContain('ZeroFS memory diagnostics unavailable');
});
