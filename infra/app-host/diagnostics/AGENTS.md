# ZeroFS memory investigation

`run.sh <output-directory>` runs the ZeroFS release pinned in `../versions.json`, validates its
archive checksum, and selects the local machine's Linux architecture. Docker and Python 3.11+
are required. The container gets a fresh local MinIO bucket, no host credentials, no external
network, two CPUs and a 5 GiB memory limit with no swap. Its FUSE mount requires `/dev/fuse` and
`SYS_ADMIN` inside Docker. Nothing attaches to production storage.

```sh
./infra/app-host/diagnostics/run.sh /tmp/zerofs-memory
```

The default run uses a 1 GiB working set, four cycles and 60 seconds idle after each explicit
flush. Each cycle writes incompressible data, reads it, overwrites half, deletes/refills the other
half, flushes, then waits. This exercises caches, segment churn and garbage collection. Set
`REPRO_TOTAL_MIB` (16..4096), `REPRO_CYCLES` (1..20), or `REPRO_IDLE_SECONDS` (1..600) to vary it.
`REPRO_ZEROFS_ARCHIVE` can point to an already downloaded archive; its checksum is still verified.

The output contains `run.json` (version, architecture, workload), `memory.jsonl` (five-second
samples plus phase boundaries), and ZeroFS, FUSE and MinIO logs. The server and object-store data
are temporary; the evidence remains in the output directory. Use a new output directory per run.

Production diagnostics in the agent log `ZeroFS memory diagnostics` every 30 seconds, independently
of VM admission and control-plane connectivity. Search for that message in VictoriaLogs, parsing
the journal JSON message when it has not already been extracted. Compare the jemalloc allocated
and resident byte fields with process RSS, cgroup anonymous/file/kernel bytes, write counters,
LSM memory and compaction counters. Missing samples are flagged, never substituted with zero.
Jemalloc retained bytes are virtual address mappings and must not be added to RSS or interpreted
as resident heap. The metrics collector itself refreshes every five seconds, so snapshots can lag
process accounting and are not atomic.

A growing allocated heap after repeated idle phases warrants an allocation-stack profile. If
allocated bytes fall while resident bytes remain high, inspect allocator fragmentation/dirty
pages; growing cgroup file bytes with stable process memory points to kernel page cache. Queued
writes growing alongside slow flushes warrant write backpressure. Cache occupancy and compaction
buffer metrics are not exposed by this release and need upstream instrumentation or a heap profile.

For an allocation-stack profile, make a separate Linux build of the pinned ZeroFS source with
jemalloc profiling enabled and debug symbols retained, then capture sampled profiles at baseline,
after churn, and after draining. The v2.3.1 Cargo file defines `release-prof` but does not define the
`heap-profiling` feature mentioned in its comment; do not assume the shipped PGO binary supports
profile dumps. Verify jemalloc `config.prof` in that build before collecting `prof.dump` snapshots.
The nibrun harness records counters and does not inject a profiler into the production process.

This is an initial reproduction harness, not proof of the incident cause. Production uses amd64,
S3, a 70 GB disk cache and NBD-backed guests; an ARM FUSE run against local MinIO differs. Once a
baseline is stable, repeat on Linux amd64 and add controlled object-store delays or NBD workloads.
Do not start a second writer against the production storage prefix.
