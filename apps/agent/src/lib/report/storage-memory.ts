import { FileSystem, HttpClient } from '@effect/platform';
import { Effect } from 'effect';
import { ZEROFS_CGROUP_PATH } from '#lib/report/memory.ts';
import { AgentConfig } from '#services/agent-config.service.ts';

const BYTES_PER_KIB = 1024;

const ZEROFS_MEMORY_METRICS = [
  'zerofs_jemalloc_allocated_bytes',
  'zerofs_jemalloc_resident_bytes',
  'zerofs_jemalloc_mapped_bytes',
  'zerofs_jemalloc_retained_bytes',
  'zerofs_jemalloc_metadata_bytes',
  'lsm_db_total_mem_size_bytes',
  'lsm_db_backpressure_count',
  'lsm_db_l0_stall_count',
  'lsm_memtable_flush_l0_flush_count',
  'lsm_object_store_error_count',
  'lsm_object_store_request_count',
  'lsm_memtable_flush_flush_request_count',
  'lsm_memtable_flush_memtable_freeze_count',
  'zerofs_bytes_read_total',
  'zerofs_bytes_written_total',
  'zerofs_segment_gc_batches_total',
  'zerofs_segment_gc_candidate_backlog',
  'zerofs_dedup_retained_results',
  'zerofs_dedup_inflight_ids',
] as const;

type StorageMemoryMetrics = Partial<Record<(typeof ZEROFS_MEMORY_METRICS)[number], number>>;

export function parseStorageMemoryMetrics(text: string): StorageMemoryMetrics {
  const values = new Map(
    text.split('\n').map((line) => {
      const [name, value] = line.trim().split(/\s+/);
      return [name, Number(value)] as const;
    }),
  );
  const sample: StorageMemoryMetrics = {};
  for (const name of ZEROFS_MEMORY_METRICS) {
    const value = values.get(name);
    if (value !== undefined && Number.isFinite(value) && value >= 0) {
      sample[name] = value;
    }
  }
  if (
    sample.zerofs_jemalloc_allocated_bytes === undefined ||
    sample.zerofs_jemalloc_resident_bytes === undefined
  ) {
    throw new Error('ZeroFS allocator metrics are missing or invalid');
  }
  return sample;
}

function integerField({ text, name, unit }: { text: string; name: string; unit: string }): number {
  const match = text.match(new RegExp(`^${name}\\s+(\\d+)${unit}$`, 'm'));
  const value = Number(match?.[1]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`ZeroFS memory field ${name} is missing or invalid`);
  }
  return value;
}

export function parseStorageCgroupMemory(text: string) {
  return {
    zerofsCgroupAnonBytes: integerField({ text, name: 'anon', unit: '' }),
    zerofsCgroupFileBytes: integerField({ text, name: 'file', unit: '' }),
    zerofsCgroupKernelBytes: integerField({ text, name: 'kernel', unit: '' }),
  };
}

export function parseStorageProcessMemory(text: string) {
  return {
    zerofsProcessRssBytes: integerField({ text, name: 'VmRSS:', unit: ' kB' }) * BYTES_PER_KIB,
    zerofsProcessAnonBytes: integerField({ text, name: 'RssAnon:', unit: ' kB' }) * BYTES_PER_KIB,
  };
}

function optionalSample<A extends object, E, R>(effect: Effect.Effect<A, E, R>) {
  return effect.pipe(
    Effect.map((fields) => ({ available: true, fields })),
    Effect.orElseSucceed(() => ({ available: false, fields: {} })),
  );
}

const readProcessMemory = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const processes = yield* fs.readFileString(`${ZEROFS_CGROUP_PATH}/cgroup.procs`);
  const pids = processes.trim().split(/\s+/);
  if (pids.length !== 1 || !/^[1-9]\d*$/.test(pids[0] ?? '')) {
    return yield* Effect.fail(new Error('ZeroFS cgroup does not contain one process'));
  }
  const zerofsPid = Number(pids[0]);
  const status = yield* fs.readFileString(`/proc/${zerofsPid}/status`);
  const sample = yield* Effect.try(() => parseStorageProcessMemory(status));
  return { zerofsPid, ...sample };
});

export const logStorageMemory = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const config = yield* AgentConfig;
  const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
  const samples = yield* Effect.all(
    {
      cgroup: optionalSample(
        fs
          .readFileString(`${ZEROFS_CGROUP_PATH}/memory.stat`)
          .pipe(Effect.flatMap((text) => Effect.try(() => parseStorageCgroupMemory(text)))),
      ),
      process: optionalSample(readProcessMemory),
      allocator: optionalSample(
        client.get(config.zerofsMetricsUrl).pipe(
          Effect.flatMap((response) => response.text),
          Effect.flatMap((text) => Effect.try(() => parseStorageMemoryMetrics(text))),
        ),
      ),
    },
    { concurrency: 'unbounded' },
  );
  const complete =
    samples.cgroup.available && samples.process.available && samples.allocator.available;
  yield* (
    complete
      ? Effect.logInfo('ZeroFS memory diagnostics')
      : Effect.logWarning('ZeroFS memory diagnostics incomplete')
  ).pipe(
    Effect.annotateLogs({
      cgroupSampleAvailable: samples.cgroup.available,
      processSampleAvailable: samples.process.available,
      allocatorSampleAvailable: samples.allocator.available,
      ...samples.cgroup.fields,
      ...samples.process.fields,
      ...samples.allocator.fields,
    }),
  );
}).pipe(
  Effect.scoped,
  Effect.timeout('2 seconds'),
  Effect.catchAll((error) => Effect.logWarning('ZeroFS memory diagnostics unavailable', error)),
);
