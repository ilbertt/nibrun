import { describe, expect, test } from 'bun:test';
import {
  type CachedImage,
  cacheBudget,
  heldBytes,
  imagesToEvict,
  referencedDigests,
} from '#lib/vm/artifact-cache.ts';
import { desiredInstance, instanceRecord } from '#tests/support/fixtures.ts';

const BYTES_PER_GIB = 1_073_741_824;
const BYTES_PER_MIB = 1_048_576;
const NONE = 0;
const ONE = 1;

/** Round enough to reason about: a quarter of a hundred gibibytes is a budget of 25 GiB. */
const DISK_TOTAL_GIB = 100;
const DISK_FREE_GIB = 50;
const IMAGE_MIB = 100;

/** Past the reserve, so only the share is deciding and a case is only ever about which go. */
const roomy = {
  totalBytes: DISK_TOTAL_GIB * BYTES_PER_GIB,
  availableBytes: DISK_FREE_GIB * BYTES_PER_GIB,
};

const IMAGE_BYTES = IMAGE_MIB * BYTES_PER_MIB;

/** More than the 25 GiB budget holds at 100 MiB apiece, so a sweep always has work to do. */
const OVER_BUDGET_COUNT = 300;

function image({ digest, usedAtMs = NONE }: { digest: string; usedAtMs?: number }): CachedImage {
  return { digest, sizeBytes: IMAGE_BYTES, usedAtMs };
}

/** `usedAtMs` ascends with the index, so `d0` is always the least recently used. */
function images({ count, prefix = 'd' }: { count: number; prefix?: string }): CachedImage[] {
  const built: CachedImage[] = [];
  for (let index = NONE; index < count; index += ONE) {
    built.push(image({ digest: `${prefix}${index}`, usedAtMs: index }));
  }
  return built;
}

function evictedFrom(held: readonly CachedImage[]) {
  return imagesToEvict({ images: held, referenced: new Set(), disk: roomy });
}

describe('a cache inside its bounds is left alone', () => {
  test('nothing is evicted while the share and the reserve both hold', () => {
    expect(evictedFrom([image({ digest: 'a' })])).toEqual([]);
  });

  test('a filesystem under its reserve is swept even where the share holds', () => {
    const tight = { totalBytes: DISK_TOTAL_GIB * BYTES_PER_GIB, availableBytes: BYTES_PER_GIB };
    expect(
      imagesToEvict({ images: [image({ digest: 'a' })], referenced: new Set(), disk: tight }),
    ).toHaveLength(ONE);
  });
});

describe('an image something still needs is never evicted', () => {
  // The one that matters: a snapshot restores its drives from paths baked into the vmstate, so
  // dropping a sleeping app's image is a tenant whose app will not come back.
  test('a host holding nothing but referenced images evicts nothing and stays over budget', () => {
    const held = images({ count: OVER_BUDGET_COUNT });
    const referenced = new Set(held.map((one) => one.digest));
    expect(imagesToEvict({ images: held, referenced, disk: roomy })).toEqual([]);
  });

  test('a referenced image is passed over even where it is the oldest of them all', () => {
    const wanted = image({ digest: 'wanted', usedAtMs: NONE });
    const held = [wanted, ...images({ count: OVER_BUDGET_COUNT, prefix: 'free' })];
    const evicting = imagesToEvict({
      images: held,
      referenced: new Set([wanted.digest]),
      disk: roomy,
    });
    expect(evicting).not.toContainEqual(wanted);
    expect(evicting.at(NONE)?.digest).toBe('free0');
  });
});

describe('what goes, goes least-recently-used first', () => {
  test('everything evicted was used longer ago than everything kept', () => {
    const held = images({ count: OVER_BUDGET_COUNT });
    const evicting = evictedFrom(held);
    const gone = new Set(evicting.map((one) => one.digest));
    const kept = held.filter((one) => !gone.has(one.digest));
    expect(Math.max(...evicting.map((one) => one.usedAtMs))).toBeLessThan(
      Math.min(...kept.map((one) => one.usedAtMs)),
    );
  });

  test('it stops as soon as enough has been reclaimed', () => {
    const held = images({ count: OVER_BUDGET_COUNT });
    const remaining = heldBytes(held) - heldBytes(evictedFrom(held));
    expect(remaining).toBeLessThanOrEqual(cacheBudget(roomy));
    // Keeping one more would have left it over, which is what makes this the smallest set.
    expect(remaining + IMAGE_BYTES).toBeGreaterThan(cacheBudget(roomy));
  });
});

describe('what counts as needed', () => {
  test('a release the control plane names is held even with no record of it yet', () => {
    const referenced = referencedDigests({ desired: [desiredInstance()], records: [] });
    expect(referenced.has(desiredInstance().artifact.digest)).toBe(true);
  });

  test('an image this host is holding is kept even once desired state has moved on', () => {
    const referenced = referencedDigests({ desired: [], records: [instanceRecord()] });
    expect(referenced.has(instanceRecord().artifactDigest)).toBe(true);
  });
});
