import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppResourcesCard } from '#components/apps/app-resources-card.tsx';
import type { AppSummary } from '#queries/apps.ts';

const VCPU_COUNT = 2;
const MEMORY_MIB = 1_024;
const VOLUME_SIZE_BYTES = 8_589_934_592;
const MEMORY_USED_BYTES = 412_401_664;
const VOLUME_USED_BYTES = 1_503_238_553;
const CPU_SHARE = 0.18;
const BYTES_PER_MIB = 1_048_576;
const HEALTHY_SHARE = 0.4;
const NEARLY_FULL_SHARE = 0.85;
const CRITICAL_SHARE = 0.95;
const MEASURED_AT = '2026-08-29T11:01:00.000Z';

// Cast once, because what this file is about is the markup and the branding belongs to the wire.
function app(overrides: Partial<AppSummary> = {}): AppSummary {
  return {
    config: {
      volumeSizeBytes: VOLUME_SIZE_BYTES,
      resources: { vcpuCount: VCPU_COUNT, memoryMib: MEMORY_MIB },
    },
    volumeUsage: null,
    computeUsage: null,
    ...overrides,
  } as AppSummary;
}

const measured = app({
  volumeUsage: {
    totalBytes: VOLUME_SIZE_BYTES,
    usedBytes: VOLUME_USED_BYTES,
    measuredAt: MEASURED_AT,
  },
  computeUsage: {
    memoryTotalBytes: MEMORY_MIB,
    memoryUsedBytes: MEMORY_USED_BYTES,
    cpuShare: CPU_SHARE,
    measuredAt: MEASURED_AT,
  },
} as Partial<AppSummary>);

describe('what an app is using is read against what it was given', () => {
  test('each resource reads as what is spent over what was allocated', () => {
    const markup = renderToStaticMarkup(<AppResourcesCard app={measured} />);

    expect(markup).toContain('0.36');
    expect(markup).toContain('(18%)');
    expect(markup).toContain('393.3 MiB');
    expect(markup).toContain('1.4 GiB');
    expect(markup).toContain('/ 8.0 GiB');
  });

  /**
   * A reading is only taken while the app is running, so this is every app that has never come up.
   * A nought would read as an app using none of what it has, which is a different claim entirely —
   * so the ring keeps its track and says nothing, rather than saying nought.
   */
  test('a resource nothing has measured says so rather than reading as none spent', () => {
    const markup = renderToStaticMarkup(<AppResourcesCard app={app()} />);

    expect(markup).toContain('—');
    expect(markup).not.toContain('aria-valuenow');
  });

  /**
   * Green reads as headroom and red as trouble, so where the ring changes colour is a claim about
   * the app. Eighty and ninety are where disk and memory alerting has settled almost everywhere.
   */
  test('a ring turns from green through amber to red as what is left runs out', () => {
    const ringsAt = (memoryUsedBytes: number) =>
      renderToStaticMarkup(
        <AppResourcesCard
          app={app({
            computeUsage: {
              memoryTotalBytes: MEMORY_MIB,
              memoryUsedBytes,
              measuredAt: MEASURED_AT,
            },
          } as Partial<AppSummary>)}
        />,
      );
    const bytesAt = (share: number) => Math.round(MEMORY_MIB * BYTES_PER_MIB * share);

    expect(ringsAt(bytesAt(HEALTHY_SHARE))).toContain('text-primary');
    expect(ringsAt(bytesAt(NEARLY_FULL_SHARE))).toContain('text-warning');
    expect(ringsAt(bytesAt(CRITICAL_SHARE))).toContain('text-destructive');
  });

  // Memory arrives whole on the first reading and a share cannot, because a share needs a reading
  // behind it — so the vCPU row is the one that can be empty while the row under it is not.
  test('a guest measured before it had a cpu share still reads its memory', () => {
    const markup = renderToStaticMarkup(
      <AppResourcesCard
        app={app({
          computeUsage: {
            memoryTotalBytes: MEMORY_MIB,
            memoryUsedBytes: MEMORY_USED_BYTES,
            measuredAt: MEASURED_AT,
          },
        } as Partial<AppSummary>)}
      />,
    );

    expect(markup).toContain('393.3 MiB');
    expect(markup).toContain('—');
  });
});
