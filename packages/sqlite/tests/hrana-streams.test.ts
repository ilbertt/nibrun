import { describe, expect, test } from 'bun:test';
import { HranaStreams } from '#hrana-streams.ts';
import { openRecordingExecutor, RecordingSqliteExecutor } from '#tests/support/executor.ts';

const signal = new AbortController().signal;
const options = { limit: undefined, idleTimeoutMs: undefined };

describe('Hrana streams', () => {
  test('consumes batons once and binds them to their authenticated selection', async () => {
    const streams = new HranaStreams(options);
    const executor = new RecordingSqliteExecutor();
    const open = openRecordingExecutor(executor);
    const first = await streams.acquire({ baton: null, scope: 'owner/selection', open, signal });
    const baton = streams.release(first)!;
    await expect(
      streams.acquire({ baton, scope: 'another/selection', open, signal }),
    ).rejects.toThrow('invalid');
    const same = await streams.acquire({ baton, scope: 'owner/selection', open, signal });
    expect(same === first).toBe(true);
    await expect(
      streams.acquire({ baton, scope: 'owner/selection', open, signal }),
    ).rejects.toThrow('invalid');
    const rotated = streams.release(same)!;
    expect(rotated === baton).toBe(false);
    await streams.closeAll();
    expect(executor.closed).toBe(true);
  });

  test('expires idle connections and releases their batons', async () => {
    const IDLE_TIMEOUT_MS = 5;
    const WAIT_MS = 20;
    const streams = new HranaStreams({ limit: undefined, idleTimeoutMs: IDLE_TIMEOUT_MS });
    const executor = new RecordingSqliteExecutor();
    const open = openRecordingExecutor(executor);
    const stream = await streams.acquire({ baton: null, scope: 'selection', open, signal });
    const baton = streams.release(stream)!;
    await Bun.sleep(WAIT_MS);
    expect(executor.closed).toBe(true);
    await expect(streams.acquire({ baton, scope: 'selection', open, signal })).rejects.toThrow(
      'expired',
    );
  });

  test('bounds live connections including opens still in flight', async () => {
    const streams = new HranaStreams({ limit: 1, idleTimeoutMs: undefined });
    const executor = new RecordingSqliteExecutor();
    const opening = Promise.withResolvers<RecordingSqliteExecutor>();
    function open() {
      return opening.promise;
    }
    const first = streams.acquire({ baton: null, scope: 'selection', open, signal });
    await expect(
      streams.acquire({ baton: null, scope: 'selection', open, signal }),
    ).rejects.toThrow('Too many');
    opening.resolve(executor);
    await first;
    await streams.closeAll();
    expect(executor.closed).toBe(true);
  });

  test('closes an executor when its opening request is cancelled', async () => {
    const streams = new HranaStreams(options);
    const controller = new AbortController();
    const executor = new RecordingSqliteExecutor();
    const opening = Promise.withResolvers<RecordingSqliteExecutor>();
    function open() {
      return opening.promise;
    }
    const first = streams.acquire({
      baton: null,
      scope: 'selection',
      open,
      signal: controller.signal,
    });
    controller.abort(new Error('cancelled'));
    opening.resolve(executor);
    await expect(first).rejects.toThrow('cancelled');
    expect(executor.closed).toBe(true);
  });
});

test('scope invalidation also closes an executor still opening', async () => {
  const streams = new HranaStreams(options);
  const executor = new RecordingSqliteExecutor();
  const opening = Promise.withResolvers<RecordingSqliteExecutor>();
  function open() {
    return opening.promise;
  }
  const first = streams.acquire({ baton: null, scope: 'selection', open, signal });
  await streams.closeScope('selection');
  opening.resolve(executor);
  await expect(first).rejects.toThrow('invalidated');
  expect(executor.closed).toBe(true);
  await streams.closeAll();
});

test('shutdown releases every stream even if one executor fails to close', async () => {
  class FailingCloseExecutor extends RecordingSqliteExecutor {
    override close(): Promise<void> {
      return Promise.reject(new Error('cannot close'));
    }
  }
  const streams = new HranaStreams(options);
  await streams.acquire({
    baton: null,
    scope: 'first',
    open: openRecordingExecutor(new FailingCloseExecutor()),
    signal,
  });
  const executor = new RecordingSqliteExecutor();
  await streams.acquire({
    baton: null,
    scope: 'second',
    open: openRecordingExecutor(executor),
    signal,
  });
  await expect(streams.closeAll()).rejects.toThrow('failed to close');
  expect(executor.closed).toBe(true);
  await expect(
    streams.acquire({
      baton: null,
      scope: 'second',
      open: openRecordingExecutor(executor),
      signal,
    }),
  ).rejects.toThrow('closed');
});
