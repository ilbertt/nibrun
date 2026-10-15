import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import type { ServerAnalyticsInput } from '#lib/analytics.ts';
import { UmamiRepository } from '#repositories/umami.repository.ts';
import { AnalyticsService } from '#services/analytics.service.ts';
import { ANALYTICS_INPUT } from '#tests/support/analytics.ts';

function repository() {
  return new UmamiRepository({
    endpoint: new URL('https://analytics.example.test/api/send'),
    hostname: 'api.example.test',
  });
}

afterEach(function restoreMocks() {
  mock.restore();
});

test('analytics service contains HTTP failures without reading or logging response bodies', async () => {
  const send = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('private response', { status: 503 }),
  );
  const log = spyOn(console, 'log').mockImplementation(function ignoreLog() {});
  await expect(new AnalyticsService(repository()).track(ANALYTICS_INPUT)).resolves.toBeUndefined();
  expect(send).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(log.mock.calls)).not.toContain('private response');
});

test('analytics service contains network failures', async () => {
  spyOn(globalThis, 'fetch').mockRejectedValue(new Error('private network details'));
  const log = spyOn(console, 'log').mockImplementation(function ignoreLog() {});
  await expect(new AnalyticsService(repository()).track(ANALYTICS_INPUT)).resolves.toBeUndefined();
  expect(JSON.stringify(log.mock.calls)).not.toContain('private network details');
});

test('limits pending delivery during an outage and accepts events again after recovery', async () => {
  const delivered: ServerAnalyticsInput[] = [];
  const blocked = Promise.withResolvers<void>();
  const service = new AnalyticsService({
    send(event) {
      delivered.push(event);
      return blocked.promise;
    },
  });
  const eventCount = 100;
  const pending = Array.from({ length: eventCount }, () => service.track(ANALYTICS_INPUT));
  expect(delivered.length).toBeGreaterThan(0);
  expect(delivered.length).toBeLessThan(eventCount);
  const beforeRecovery = delivered.length;
  blocked.resolve();
  await Promise.all(pending);
  await service.track(ANALYTICS_INPUT);
  expect(delivered).toHaveLength(beforeRecovery + 1);
});
