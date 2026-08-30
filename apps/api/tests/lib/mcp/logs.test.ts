import { expect, test } from 'bun:test';
import { called, toolCall } from '#tests/lib/mcp/support/call.ts';
import {
  anApp,
  aRunningRelease,
  SLUG,
  servicesHolding,
  someOutput,
} from '#tests/lib/mcp/support/services.ts';

const MAX_RECORDS = 500;

type Output = { records: { message: string }[]; truncated: boolean };

async function readLogs({ lines }: { lines: number }): Promise<Output> {
  const replied = await called({
    services: servicesHolding({
      apps: [anApp({ state: 'active' })],
      deployments: [aRunningRelease()],
      output: someOutput({ lines }),
    }),
    body: toolCall({ name: 'read_logs', args: { app: SLUG } }),
  });
  return replied.result?.structuredContent as Output;
}

test('a log that fits comes back whole and says so', async () => {
  const output = await readLogs({ lines: 3 });

  expect(output.truncated).toBe(false);
  expect(output.records.map((record) => record.message)).toEqual(['line 0', 'line 1', 'line 2']);
});

/**
 * The end of the window rather than the start of it. The stream is oldest first, so stopping at
 * the cap would keep the beginning and drop the end — and the end is what someone asking about a
 * failure came for.
 */
test('a log over the cap keeps its last words, not its first', async () => {
  const output = await readLogs({ lines: MAX_RECORDS + 2 });

  expect(output.truncated).toBe(true);
  expect(output.records).toHaveLength(MAX_RECORDS);
  expect(output.records[0]?.message).toBe('line 2');
  expect(output.records.at(-1)?.message).toBe(`line ${MAX_RECORDS + 1}`);
});
