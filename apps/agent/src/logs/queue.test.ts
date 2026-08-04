import { describe, expect, test } from 'bun:test';
import type { AppId, DeploymentId, InstanceId, TenantLogEvent, Timestamp } from '@repo/protocol';
import { TenantLogQueue } from '#logs/queue.ts';

const event = (sequence = 0): TenantLogEvent => ({
  kind: 'data',
  sourceId: 'source-1',
  sequence,
  observedAt: '2026-08-04T12:00:00Z' as Timestamp,
  appId: 'app-1' as AppId,
  deploymentId: 'deployment-1' as DeploymentId,
  instanceId: 'instance-1' as InstanceId,
  stream: 'stdout',
  text: 'hello\n',
});

describe('the bounded upload queue', () => {
  test('it emits one complete NDJSON event at a time', async () => {
    const queue = new TenantLogQueue({ maxBytes: 4096 });
    expect(queue.push(event())).toBe(true);

    const reader = queue.readable().getReader();
    const result = await reader.read();
    expect(result.done).toBe(false);
    expect(JSON.parse(new TextDecoder().decode(result.value))).toEqual(event());
    await reader.cancel();
  });

  test('it refuses growth past its byte limit instead of blocking the producer', () => {
    const queue = new TenantLogQueue({ maxBytes: 1 });
    expect(queue.push(event())).toBe(false);
  });

  test('canceling one HTTP request leaves later events for its replacement', async () => {
    const queue = new TenantLogQueue({ maxBytes: 4096 });
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
