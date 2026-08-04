import { describe, expect, test } from 'bun:test';
import type { AppId, DeploymentId, InstanceId, TenantLogEvent, Timestamp } from '@repo/protocol';
import { TenantLogQueue } from '#logs/queue.ts';

const AFTER_THE_STREAM_ENDED = 7;
// Larger than any test puts through it, for the limit a given test is not about.
const LARGE = 1_048_576;

function limits() {
  return { maxBytes: LARGE, maxInFlightBytes: LARGE };
}

// Sized from the encoding rather than guessed, so a field added to the event does not silently
// turn a limit of three events into a limit of two.
function oneEvent(): number {
  return new TextEncoder().encode(`${JSON.stringify(event())}\n`).byteLength;
}

function event(sequence = 0): TenantLogEvent {
  return {
    kind: 'data',
    sourceId: 'source-1',
    sequence,
    observedAt: '2026-08-04T12:00:00Z' as Timestamp,
    appId: 'app-1' as AppId,
    deploymentId: 'deployment-1' as DeploymentId,
    instanceId: 'instance-1' as InstanceId,
    stream: 'stdout',
    text: 'hello\n',
  };
}

describe('the bounded upload queue', () => {
  test('it emits one complete NDJSON event at a time', async () => {
    const queue = new TenantLogQueue(limits());
    expect(queue.push(event())).toBe(true);

    const reader = queue.readable().getReader();
    const result = await reader.read();
    expect(result.done).toBe(false);
    expect(JSON.parse(new TextDecoder().decode(result.value))).toEqual(event());
    await reader.cancel();
  });

  // A host whose apps are quiet still has to hold the request open, and every timeout between
  // here and the control plane counts silence as a dead connection.
  test('a keepalive is an empty line, so it carries no event', async () => {
    const queue = new TenantLogQueue(limits());
    expect(queue.keepalive()).toBe(true);

    const reader = queue.readable().getReader();
    const result = await reader.read();
    expect(new TextDecoder().decode(result.value)).toBe('\n');
    await reader.cancel();
  });

  // The point of ending a stream rather than cutting it: an upload cut mid-flight loses whatever
  // the request had already taken, and HTTP cannot say how much that was.
  test('ending a stream hands over everything queued before it stops', async () => {
    const queue = new TenantLogQueue(limits());
    expect(queue.push(event(1))).toBe(true);
    expect(queue.push(event(2))).toBe(true);

    const reader = queue.readable().getReader();
    queue.endStream();

    expect(JSON.parse(new TextDecoder().decode((await reader.read()).value)).sequence).toBe(1);
    expect(JSON.parse(new TextDecoder().decode((await reader.read()).value)).sequence).toBe(2);
    expect((await reader.read()).done).toBe(true);
  });

  test('an event that arrives after a stream ended waits for the one that replaces it', async () => {
    const queue = new TenantLogQueue(limits());
    const ending = queue.readable().getReader();
    queue.endStream();
    expect((await ending.read()).done).toBe(true);

    expect(queue.push(event(AFTER_THE_STREAM_ENDED))).toBe(true);
    const replacement = queue.readable().getReader();
    expect(JSON.parse(new TextDecoder().decode((await replacement.read()).value)).sequence).toBe(
      AFTER_THE_STREAM_ENDED,
    );
    await replacement.cancel();
  });

  // The window fires whether or not the queue happens to be empty, and an idle host is the case
  // where it always is.
  test('a stream ended while nothing is queued closes rather than hanging', async () => {
    const queue = new TenantLogQueue(limits());
    const reader = queue.readable().getReader();
    const pending = reader.read();
    queue.endStream();

    expect((await pending).done).toBe(true);
  });

  // The whole point of holding copies: a request that dies takes nothing with it.
  test('an upload that is never confirmed hands its events to the next one', async () => {
    const queue = new TenantLogQueue(limits());
    expect(queue.push(event(1))).toBe(true);
    expect(queue.push(event(2))).toBe(true);

    const failed = queue.readable().getReader();
    expect(JSON.parse(new TextDecoder().decode((await failed.read()).value)).sequence).toBe(1);
    expect(JSON.parse(new TextDecoder().decode((await failed.read()).value)).sequence).toBe(2);
    await failed.cancel();

    const replacement = queue.readable().getReader();
    expect(JSON.parse(new TextDecoder().decode((await replacement.read()).value)).sequence).toBe(1);
    expect(JSON.parse(new TextDecoder().decode((await replacement.read()).value)).sequence).toBe(2);
    await replacement.cancel();
  });

  test('a confirmed upload does not hand them over again', async () => {
    const queue = new TenantLogQueue(limits());
    expect(queue.push(event(1))).toBe(true);

    const delivered = queue.readable().getReader();
    expect(JSON.parse(new TextDecoder().decode((await delivered.read()).value)).sequence).toBe(1);
    queue.acknowledge();
    await delivered.cancel();

    const replacement = queue.readable().getReader();
    const pending = replacement.read();
    queue.endStream();
    expect((await pending).done).toBe(true);
  });

  // Copies are held until they are confirmed, so a request that is never confirmed must not be
  // able to hold more of this host's memory than the buffer it was drawn from.
  test('what is held for an unconfirmed upload answers to the same byte limit', async () => {
    const queue = new TenantLogQueue({ maxBytes: oneEvent() * 2, maxInFlightBytes: LARGE });
    expect(queue.push(event(1))).toBe(true);
    expect(queue.push(event(2))).toBe(true);

    const reader = queue.readable().getReader();
    await reader.read();
    await reader.read();

    // Both are in flight rather than queued, and the budget has not reopened because of it.
    expect(queue.push(event())).toBe(false);
    queue.acknowledge();
    expect(queue.push(event())).toBe(true);
    await reader.cancel();
  });

  test('an upload ends once it is carrying its limit, leaving the rest queued', async () => {
    const queue = new TenantLogQueue({ maxBytes: LARGE, maxInFlightBytes: oneEvent() });
    expect(queue.push(event(1))).toBe(true);
    expect(queue.push(event(2))).toBe(true);

    const first = queue.readable().getReader();
    expect(JSON.parse(new TextDecoder().decode((await first.read()).value)).sequence).toBe(1);
    expect((await first.read()).done).toBe(true);
    queue.acknowledge();

    const second = queue.readable().getReader();
    expect(JSON.parse(new TextDecoder().decode((await second.read()).value)).sequence).toBe(2);
    await second.cancel();
  });

  test('it refuses growth past its byte limit instead of blocking the producer', () => {
    const queue = new TenantLogQueue({ maxBytes: 1, maxInFlightBytes: LARGE });
    expect(queue.push(event())).toBe(false);
  });

  // A control plane that answers before the body ends leaves the request stream uncancelled, so
  // the reader it was draining stays pending. Whatever arrives next belongs to the reconnect.
  test('a reader the control plane abandoned does not swallow the next event', async () => {
    const queue = new TenantLogQueue(limits());
    const abandoned = queue.readable().getReader();
    const neverDelivered = abandoned.read();

    const replacement = queue.readable().getReader();
    expect(queue.push(event(1))).toBe(true);

    const result = await replacement.read();
    expect(JSON.parse(new TextDecoder().decode(result.value)).sequence).toBe(1);
    expect((await neverDelivered).done).toBe(true);
    await replacement.cancel();
  });

  test('canceling one HTTP request leaves later events for its replacement', async () => {
    const queue = new TenantLogQueue(limits());
    const first = queue.readable().getReader();
    const pending = first.read();
    await first.cancel();
    expect((await pending).done).toBe(true);

    expect(queue.push(event(1))).toBe(true);
    const replacement = queue.readable().getReader();
    const result = await replacement.read();
    expect(JSON.parse(new TextDecoder().decode(result.value)).sequence).toBe(1);
    await replacement.cancel();
  });
});
