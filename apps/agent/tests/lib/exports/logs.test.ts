import { describe, expect, test } from 'bun:test';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Either } from 'effect';
import { writeExportLogs } from '#lib/exports/logs.ts';
import { tenantLogRecord } from '#lib/logs/event.ts';
import { HOST_ID, tenantLogEvent } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(platform);
const PRIVATE_MODE = 0o600;
const RECORD = tenantLogRecord({ event: tenantLogEvent(), hostId: HOST_ID });

async function* events(values: readonly unknown[]) {
  yield* values;
}

function writing(values: readonly unknown[]) {
  return Effect.gen(function* () {
    const directory = yield* temporaryDirectory;
    const destination = join(directory, 'logs.jsonl');
    const result = yield* Effect.either(
      writeExportLogs({ events: events(values), destination, cancel: Effect.void }),
    );
    const contents = yield* Effect.promise(() => readFile(destination, 'utf8').catch(() => null));
    const mode = yield* Effect.promise(() =>
      stat(destination)
        .then((file) => file.mode & 0o777)
        .catch(() => null),
    );
    return { result, contents, mode };
  });
}

describe('logs in an export', () => {
  test('keeps metadata and literal output in private JSON lines', async () => {
    const record = { ...RECORD, _msg: 'line one\n秘密\n', stream: 'stderr' };
    const { result, contents, mode } = await run(
      writing([
        { event: 'log', data: record },
        { event: 'complete', data: {} },
      ]),
    );
    expect(Either.isRight(result) && result.right).toBe(true);
    expect(contents).toBe(`${JSON.stringify(record)}\n`);
    expect(mode).toBe(PRIVATE_MODE);
  });

  test('does not leave a file for an app with no retained output', async () => {
    const { result, contents } = await run(writing([{ event: 'complete', data: {} }]));
    expect(Either.isRight(result) && result.right).toBe(false);
    expect(contents).toBeNull();
  });

  test.each([
    { values: [] },
    { values: [{ event: 'log', data: RECORD }] },
    {
      values: [
        { event: 'log', data: { _msg: 'malformed' } },
        { event: 'complete', data: {} },
      ],
    },
    {
      values: [
        { event: 'complete', data: {} },
        { event: 'log', data: RECORD },
      ],
    },
  ])('rejects an incomplete or invalid stream: %j', async ({ values }) => {
    const { result } = await run(writing(values));
    expect(Either.isLeft(result)).toBe(true);
  });
});
