import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AGENT_API_PREFIX,
  AGENT_ROUTES,
  PROTOCOL_VERSION_HEADER,
  SecretStringSchema,
  Value,
} from '@repo/protocol';
import { Effect, Either, Exit, Fiber } from 'effect';
import { makeControlPlaneClient } from '#lib/control/client.ts';
import { writeExportLogs } from '#lib/exports/logs.ts';
import { tenantLogRecord } from '#lib/logs/event.ts';
import { EXPORT_ID, HOST_ID, tenantLogEvent } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import { serving } from '#tests/support/server.ts';

const run = provided(platform);
const SESSION_TOKEN = Value.Parse(SecretStringSchema, 'session-token');
const RECORD = {
  ...tenantLogRecord({ event: tenantLogEvent(), hostId: HOST_ID }),
  _msg: 'héllo\n秘密',
};

function transfer({ complete }: { complete: boolean }) {
  return Effect.gen(function* () {
    const received: Request[] = [];
    const bodies: unknown[] = [];
    const { baseUrl } = yield* serving(async (request) => {
      received.push(request);
      bodies.push(await request.json());
      const body = `event: log\ndata: ${JSON.stringify(RECORD)}\n\n${complete ? 'event: complete\ndata: {}\n\n' : ''}`;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const byte of new TextEncoder().encode(body)) {
              controller.enqueue(new Uint8Array([byte]));
            }
            controller.close();
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    });
    const controller = new AbortController();
    const records = yield* makeControlPlaneClient({ baseUrl }).fetchExportLogs({
      sessionToken: SESSION_TOKEN,
      request: { exportId: EXPORT_ID },
      signal: controller.signal,
    });
    const directory = yield* temporaryDirectory;
    const destination = join(directory, 'logs.jsonl');
    const result = yield* Effect.either(
      writeExportLogs({
        events: records,
        destination,
        cancel: Effect.sync(() => controller.abort()),
      }),
    );
    const contents = yield* Effect.promise(() => readFile(destination, 'utf8'));
    return { received, result, contents, body: bodies[0] };
  });
}

describe('export logs over the authenticated control channel', () => {
  test('streams fragmented output into JSON lines without changing Unicode or timestamps', async () => {
    const { received, result, contents, body } = await run(transfer({ complete: true }));
    expect(Either.isRight(result) && result.right).toBe(true);
    expect(contents).toBe(`${JSON.stringify(RECORD)}\n`);
    expect(new URL(received[0]!.url).pathname).toBe(
      `${AGENT_API_PREFIX}${AGENT_ROUTES.exportLogs}`,
    );
    expect(received[0]!.headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(received[0]!.headers.has(PROTOCOL_VERSION_HEADER)).toBe(true);
    expect(body).toEqual({ exportId: EXPORT_ID });
  });

  test('a connection closing before completion cannot create a successful export', async () => {
    const { result } = await run(transfer({ complete: false }));
    expect(Either.isLeft(result) && result.left._tag).toBe('ExportLogsIncomplete');
  });

  test('interrupting a silent transfer closes the socket before returning its iterator', async () => {
    const result = await run(
      Effect.gen(function* () {
        const waiting = Promise.withResolvers<void>();
        const { baseUrl } = yield* serving(
          () =>
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(
                    new TextEncoder().encode(`event: log\ndata: ${JSON.stringify(RECORD)}\n\n`),
                  );
                },
              }),
              { headers: { 'content-type': 'text/event-stream' } },
            ),
        );
        const controller = new AbortController();
        const records = yield* makeControlPlaneClient({ baseUrl }).fetchExportLogs({
          sessionToken: SESSION_TOKEN,
          request: { exportId: EXPORT_ID },
          signal: controller.signal,
        });
        async function* observing() {
          for await (const record of records) {
            yield record;
            waiting.resolve();
          }
        }
        const directory = yield* temporaryDirectory;
        const fiber = yield* Effect.fork(
          writeExportLogs({
            events: observing(),
            destination: join(directory, 'logs.jsonl'),
            cancel: Effect.sync(() => controller.abort()),
          }),
        );
        yield* Effect.promise(() => waiting.promise);
        const exit = yield* Fiber.interrupt(fiber);
        return { exit, aborted: controller.signal.aborted };
      }),
    );
    expect(Exit.isInterrupted(result.exit)).toBe(true);
    expect(result.aborted).toBe(true);
  });
});
