import { expect, test } from 'bun:test';
import { FileSystem } from '@effect/platform';
import {
  type AppId,
  AppIdSchema,
  parseMessage,
  type TenantLogRecord,
  TenantLogRecordSchema,
} from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect } from 'effect';
import { makeLogStoreClient } from '#lib/logs/store-client.ts';
import {
  makeNibrunnerLogCursors,
  NibrunnerLogCursorsUnavailable,
} from '#lib/nibrunner/log-cursors.ts';
import { makeNibrunnerLogDelivery } from '#lib/nibrunner/log-delivery.ts';
import { NibrunnerLogCursors } from '#services/nibrunner-log-cursors.service.ts';
import { APP_ID, HOST_ID } from '#tests/support/fixtures.ts';
import { nibrunnerTenantLog } from '#tests/support/nibrunner.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import { HTTP_OK, HTTP_UNAVAILABLE, serving } from '#tests/support/server.ts';

const run = provided(platform);
const SECOND_APP_ID = Value.Parse(AppIdSchema, 'second-app');
const FLOOD_RECORDS = 20;
const MESSAGE_LENGTH = 60_000;
const input = { appIds: [APP_ID], hostId: HOST_ID };

function busyLog(appId: AppId) {
  const lines: string[] = [];
  for (let sequence = 0; sequence < FLOOD_RECORDS; sequence++) {
    lines.push(
      `${JSON.stringify({ ...nibrunnerTenantLog(), appId, sequence, text: 'x'.repeat(MESSAGE_LENGTH) })}\n`,
    );
  }
  return lines.join('');
}

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* temporaryDirectory;
  const requests: TenantLogRecord[][] = [];
  const world = { status: 200 };
  const { baseUrl } = yield* serving(async (request) => {
    requests.push(
      (await request.text())
        .trimEnd()
        .split('\n')
        .map((line) => parseMessage({ schema: TenantLogRecordSchema, value: JSON.parse(line) })),
    );
    return new Response('', { status: world.status });
  });
  const store = makeLogStoreClient({ baseUrl });
  const cursors = yield* makeNibrunnerLogCursors({ file: `${directory}/cursors.json` });
  const delivery = yield* makeNibrunnerLogDelivery({ directory, store, cursors });
  const file = `${directory}/${APP_ID}.jsonl`;
  return { fs, directory, file, store, cursors, delivery, requests, world };
});

test('successful delivery checkpoints records and does not send them again', async () => {
  await run(
    Effect.gen(function* () {
      const { fs, file, delivery, cursors, requests } = yield* fixture;
      const line = `${JSON.stringify(nibrunnerTenantLog())}\n`;
      yield* fs.writeFileString(file, line);
      expect(yield* delivery.send(input)).toBe(true);
      expect((yield* cursors.get(APP_ID))?.offset).toBe(Buffer.byteLength(line));
      expect(yield* delivery.send(input)).toBe(false);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.[0]).toMatchObject({
        appId: APP_ID,
        hostId: HOST_ID,
        _msg: 'tenant output',
        sourceId: 'nibrunner-source',
        sequence: 0,
      });
    }),
  );
});

test('a rejected upload leaves its position unchanged for retry', async () => {
  await run(
    Effect.gen(function* () {
      const { fs, file, delivery, cursors, requests, world } = yield* fixture;
      yield* fs.writeFileString(file, `${JSON.stringify(nibrunnerTenantLog())}\n`);
      world.status = HTTP_UNAVAILABLE;
      expect((yield* Effect.flip(delivery.send(input)))._tag).toBe('LogStoreError');
      expect(yield* cursors.get(APP_ID)).toBeUndefined();
      world.status = HTTP_OK;
      expect(yield* delivery.send(input)).toBe(true);
      expect(requests[1]).toEqual(requests[0]);
    }),
  );
});

test('blank tenant and cron lines keep their terminators without being replayed', async () => {
  await run(
    Effect.gen(function* () {
      const { fs, file, delivery, cursors, requests } = yield* fixture;
      const records = [
        { ...nibrunnerTenantLog(), sequence: 0, text: '\n' },
        {
          ...nibrunnerTenantLog(),
          kind: 'cron-data',
          sequence: 1,
          jobId: 'job',
          runId: 'run',
          text: '\n',
        },
      ];
      const lines = records.map((record) => `${JSON.stringify(record)}\n`).join('');
      yield* fs.writeFileString(file, lines);
      expect(yield* delivery.send(input)).toBe(true);
      expect((yield* cursors.get(APP_ID))?.offset).toBe(Buffer.byteLength(lines));
      expect(yield* delivery.send(input)).toBe(false);
      expect(requests).toHaveLength(1);
      expect(
        requests[0]?.map(function message(record) {
          return record._msg;
        }),
      ).toEqual(['\n', '\n']);
      expect(
        requests[0]?.map(function sequence(record) {
          return record.sequence;
        }),
      ).toEqual([0, 1]);
      yield* fs.writeFileString(
        file,
        `${lines}${JSON.stringify({ ...nibrunnerTenantLog(), sequence: 2 })}\n`,
      );
      yield* delivery.send(input);
      expect(requests).toHaveLength(2);
      expect(requests[1]?.map((record) => record.sequence)).toEqual([2]);
    }),
  );
});

test('a failed position commit replays acknowledged event identities safely', async () => {
  await run(
    Effect.gen(function* () {
      const { fs, file, directory, store, cursors, delivery, requests } = yield* fixture;
      yield* fs.writeFileString(file, `${JSON.stringify(nibrunnerTenantLog())}\n`);
      const failing = yield* makeNibrunnerLogDelivery({
        directory,
        store,
        cursors: NibrunnerLogCursors.make({
          get: cursors.get,
          commit: () => Effect.fail(new NibrunnerLogCursorsUnavailable()),
        }),
      });
      expect((yield* Effect.flip(failing.send(input)))._tag).toBe('NibrunnerLogCursorsUnavailable');
      expect(yield* cursors.get(APP_ID)).toBeUndefined();
      yield* delivery.send(input);
      expect(requests[1]).toEqual(requests[0]);
    }),
  );
});

test('invalid and foreign records do not block valid records or leak their contents', async () => {
  await run(
    Effect.gen(function* () {
      const { fs, file, delivery, requests } = yield* fixture;
      yield* fs.writeFileString(
        file,
        `not-json\n${JSON.stringify({ ...nibrunnerTenantLog(), appId: SECOND_APP_ID, text: 'foreign-secret' })}\n${JSON.stringify(nibrunnerTenantLog())}\n`,
      );
      yield* delivery.send(input);
      expect(requests[0]).toHaveLength(1);
      expect(JSON.stringify(requests)).not.toContain('foreign-secret');
    }),
  );
});

test('a busy app cannot starve another app of bounded delivery', async () => {
  await run(
    Effect.gen(function* () {
      const { fs, directory, delivery, requests } = yield* fixture;
      for (const appId of [APP_ID, SECOND_APP_ID]) {
        const lines = busyLog(appId);
        yield* fs.writeFileString(`${directory}/${appId}.jsonl`, lines);
      }
      const all = { appIds: [APP_ID, SECOND_APP_ID], hostId: HOST_ID };
      yield* delivery.send(all);
      yield* delivery.send(all);
      expect(new Set(requests[0]?.map((record) => record.appId))).toEqual(new Set([APP_ID]));
      expect(new Set(requests[1]?.map((record) => record.appId))).toEqual(new Set([SECOND_APP_ID]));
    }),
  );
});
