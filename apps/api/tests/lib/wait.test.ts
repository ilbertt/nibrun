import { describe, expect, test } from 'bun:test';
import { wait } from '#lib/wait.ts';

const A_PAUSE_MS = 40;
const A_LONGER_PAUSE_MS = 5_000;
const SOONER_MS = 20;
const TOLERANCE_MS = 200;

describe('a pause ends on its own or on the signal, whichever comes first', () => {
  test('nothing happening is waited out', async () => {
    const startedAt = Date.now();

    await wait({ ms: A_PAUSE_MS, signal: AbortSignal.timeout(A_LONGER_PAUSE_MS) });

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(A_PAUSE_MS);
  });

  test('a signal that fires first ends the pause', async () => {
    const startedAt = Date.now();

    await wait({ ms: A_LONGER_PAUSE_MS, signal: AbortSignal.timeout(SOONER_MS) });

    expect(Date.now() - startedAt).toBeLessThan(A_LONGER_PAUSE_MS);
  });

  test('a signal that has already fired is not waited on at all', async () => {
    const startedAt = Date.now();
    const signal = AbortSignal.timeout(SOONER_MS);
    await wait({ ms: A_PAUSE_MS, signal });

    await wait({ ms: A_LONGER_PAUSE_MS, signal });

    expect(Date.now() - startedAt).toBeLessThan(A_LONGER_PAUSE_MS);
  });

  /**
   * The reason the abort listener is left attached. Taking the last one off a signal from
   * `AbortSignal.timeout` stops its timer for good, so a pause that tidied up after itself would
   * be what kept every ceiling built on one from ever firing.
   */
  test('a signal survives the pauses that listened to it', async () => {
    const signal = AbortSignal.timeout(A_PAUSE_MS);

    await wait({ ms: SOONER_MS, signal });
    expect(signal.aborted).toBe(false);
    await Bun.sleep(A_PAUSE_MS + TOLERANCE_MS);

    expect(signal.aborted).toBe(true);
  });
});
