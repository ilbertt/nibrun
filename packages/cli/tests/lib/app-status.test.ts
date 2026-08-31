import { describe, expect, test } from 'bun:test';
import { type AppStatusReport, renderStatus } from '#lib/app-status.ts';
import {
  BYTES_PER_MIB,
  MEMORY_MIB,
  SLUG,
  VCPU_COUNT,
  VOLUME_SIZE_BYTES,
} from '#tests/support/app.ts';

const MEMORY_USED_BYTES = 412_401_664;
const VOLUME_USED_BYTES = 1_503_238_553;
const CPU_SHARE = 0.18;
const MEASURED_AT = '2026-08-29T11:01:00.000Z';

function app(overrides: Partial<AppStatusReport> = {}): AppStatusReport {
  return {
    slug: SLUG,
    status: 'running',
    vcpu: { used: null, total: VCPU_COUNT, measuredAt: null },
    memory: { used: null, total: MEMORY_MIB * BYTES_PER_MIB, measuredAt: null },
    volume: { used: null, total: VOLUME_SIZE_BYTES, measuredAt: null },
    ...overrides,
  };
}

const measured = app({
  vcpu: { used: CPU_SHARE * VCPU_COUNT, total: VCPU_COUNT, measuredAt: MEASURED_AT },
  memory: {
    used: MEMORY_USED_BYTES,
    total: MEMORY_MIB * BYTES_PER_MIB,
    measuredAt: MEASURED_AT,
  },
  volume: { used: VOLUME_USED_BYTES, total: VOLUME_SIZE_BYTES, measuredAt: MEASURED_AT },
});

describe('a status says what one app is using of what it was given', () => {
  test('every resource reads as what is spent over what was allocated', () => {
    const { lines } = renderStatus(measured);

    expect(lines[0]).toBe(`${SLUG}  running`);
    expect(lines.join('\n')).toContain('vCPU    0.36 / 2');
    expect(lines.join('\n')).toContain('Memory  393.3 MiB / 1.0 GiB');
    expect(lines.join('\n')).toContain('Volume  1.4 GiB / 8.0 GiB');
  });

  // A reading is only taken while the app is running, so this is every app that has never come up.
  test('a resource nothing has measured says so rather than reading as none spent', () => {
    const { lines, measured } = renderStatus(app());

    expect(lines.join('\n')).toContain('vCPU    - / 2');
    expect(lines.join('\n')).toContain('Memory  - / 1.0 GiB');
    expect(measured).toBeUndefined();
  });

  test('one moment under the table rather than the same one on every line', () => {
    const rendered = renderStatus(measured);

    expect(rendered.measured).toBe('measured at 2026-08-29 11:01');
    expect(rendered.lines.filter((line) => line.includes('2026-'))).toHaveLength(0);
  });

  /**
   * The two readings are two exchanges with the guest and can come apart, so the moment under
   * them is the older one: the newer would date a stale reading as fresh, which is the one thing
   * a moment is here to stop.
   */
  test('two readings taken apart are summarised by the older of them', () => {
    const { measured } = renderStatus(
      app({
        volume: { used: VOLUME_USED_BYTES, total: VOLUME_SIZE_BYTES, measuredAt: MEASURED_AT },
        memory: {
          used: MEMORY_USED_BYTES,
          total: MEMORY_MIB * BYTES_PER_MIB,
          measuredAt: '2026-08-27T09:12:00.000Z',
        },
      }),
    );

    expect(measured).toBe('measured at 2026-08-27 09:12');
  });

  // The dashboard's badge says this one in two words, and an owner reading both surfaces should
  // not have to work out that they are the same thing.
  test('an app nothing has ever deployed is said the way the dashboard says it', () => {
    expect(renderStatus(app({ status: 'never-deployed' })).lines[0]).toBe(
      `${SLUG}  never deployed`,
    );
  });

  // Memory is a level and arrives whole; a share needs a reading behind it and cannot.
  test('a guest measured before it had a cpu share still reads its memory', () => {
    const lines = renderStatus(
      app({
        memory: {
          used: MEMORY_USED_BYTES,
          total: MEMORY_MIB * BYTES_PER_MIB,
          measuredAt: MEASURED_AT,
        },
      }),
    ).lines.join('\n');

    expect(lines).toContain('vCPU    - / 2');
    expect(lines).toContain('Memory  393.3 MiB / 1.0 GiB');
  });
});
