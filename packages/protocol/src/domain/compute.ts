import { Type } from '@sinclair/typebox';
import { ByteSizeSchema, TimestampSchema } from '#lib/wire.ts';

/**
 * What a running app is spending on the machine it was given, as the guest kernel accounts for
 * it — the compute half of the same question `FilesystemUsage` answers about storage.
 *
 * Read from inside the guest rather than off the microVM's cgroup on the host, which measures a
 * different thing: the host sees the memory the VM has touched since it booted, and that never
 * falls when a tenant frees a page, because nothing hands guest memory back. A high-water mark
 * shown as a level is the one reading an owner would act on and be wrong.
 */

/** Between none of the vCPUs and all of them. Two vCPUs both saturated is 1, not 2. */
const CpuShareSchema = Type.Number({ minimum: 0, maximum: 1 });

/**
 * `memoryTotalBytes` reads under the memory the app was allocated, the way a filesystem reads
 * under its device: the guest kernel keeps some of it for itself before anything else runs.
 *
 * `memoryUsedBytes` is what is left once what the kernel would hand back on demand is taken off,
 * so page cache a tenant is benefiting from does not read as memory they have spent. It is the
 * number that answers whether an app is close to being killed for its memory.
 *
 * `cpuShare` is a rate and everything else here is a level, which is why it can be missing while
 * the rest is not: a rate needs two readings, so the first one taken after an agent starts has
 * nothing to have been a rate since. It is the mean over the interval ending at `measuredAt`,
 * not what is being spent at that instant.
 *
 * `measuredAt` because nothing can be measured while the app is not running: what a stopped app
 * keeps is the last reading taken before it stopped, and a number with no moment on it reads as
 * the number now.
 */
export const ComputeUsageSchema = Type.Object({
  memoryTotalBytes: ByteSizeSchema,
  memoryUsedBytes: ByteSizeSchema,
  cpuShare: Type.Optional(CpuShareSchema),
  measuredAt: TimestampSchema,
});

export type ComputeUsage = typeof ComputeUsageSchema.static;
