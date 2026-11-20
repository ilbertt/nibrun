import { Buffer } from 'node:buffer';
import { Agent, request } from 'node:http';
import type { Duplex } from 'node:stream';
import { type GuestPath, SqliteOutcomeSchema } from '@repo/protocol';
import {
  HranaErrorSchema,
  type HranaPipelineReqBody,
  type HranaPipelineRespBody,
  parseHranaPipeline,
  parseHranaPipelineResponse,
  SQLITE_MAX_REQUEST_BYTES,
  SQLITE_MAX_RESPONSE_BYTES,
} from '@repo/sqlite';
import { Value } from '@sinclair/typebox/value';
import { Duration, Effect } from 'effect';
import {
  GuestSqliteFailed,
  InvalidSqliteRequest,
  MalformedSqliteReply,
  SqliteDisconnected,
} from '#lib/sqlite/errors.ts';

export const GUEST_SQLITE_VSOCK_PORT = 51005;
const RESPONSE_TIMEOUT = Duration.seconds(10);
const SUCCESS_MIN = 200;
const SUCCESS_MAX = 300;

type HttpReply = { status: number; body: Buffer };
type SqliteHttpError =
  | GuestSqliteFailed
  | InvalidSqliteRequest
  | MalformedSqliteReply
  | SqliteDisconnected;

function httpReply({
  agent,
  method,
  path,
  body,
  signal,
}: {
  agent: Agent;
  method: 'GET' | 'POST';
  path: string;
  body: string;
  signal: AbortSignal;
}): Promise<HttpReply> {
  // biome-ignore lint/complexity/useMaxParams: Promise supplies both settlement callbacks.
  return new Promise((resolve, reject) => {
    const pending = request(
      {
        host: 'localhost',
        agent,
        method,
        path,
        signal,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let length = 0;
        response.on('data', (chunk: Buffer) => {
          length += chunk.byteLength;
          if (length > SQLITE_MAX_RESPONSE_BYTES) {
            reject(new MalformedSqliteReply());
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.once('error', reject);
        response.once('aborted', () => reject(new SqliteDisconnected()));
        response.once('end', () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }),
        );
      },
    );
    pending.once('error', reject);
    pending.end(body);
  });
}

function responseBody(reply: HttpReply) {
  if (reply.status >= SUCCESS_MIN && reply.status < SUCCESS_MAX) {
    return reply.body;
  }
  try {
    const failure: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(reply.body),
    );
    if (
      Value.Check(HranaErrorSchema, failure) &&
      failure.code &&
      Value.Check(SqliteOutcomeSchema, { status: 'failed', code: failure.code, message: '' })
    ) {
      throw new GuestSqliteFailed({ code: failure.code, reason: failure.message });
    }
  } catch (error) {
    if (isGuestFailure(error)) {
      throw error;
    }
  }
  throw new MalformedSqliteReply();
}

function isGuestFailure(error: unknown): error is GuestSqliteFailed {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    error._tag === 'GuestSqliteFailed'
  );
}

function isMalformedReply(error: unknown): error is MalformedSqliteReply {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    error._tag === 'MalformedSqliteReply'
  );
}

export function makeGuestSqliteClient({ socket }: { socket: Duplex }) {
  return Effect.gen(function* () {
    const agent = new Agent({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1 });
    let attached = false;
    agent.createConnection = function connection() {
      if (attached || socket.destroyed) {
        throw new SqliteDisconnected();
      }
      attached = true;
      socket.resume();
      return socket;
    };
    const serial = yield* Effect.makeSemaphore(1);
    let prefix: string | undefined;
    const close = Effect.sync(() => {
      agent.destroy();
      socket.destroy();
    });
    yield* Effect.addFinalizer(() => close);
    function exchange({
      method,
      path,
      body,
    }: {
      method: 'GET' | 'POST';
      path: string;
      body: string;
    }) {
      return Effect.tryPromise({
        try: (signal) => httpReply({ agent, method, path, body, signal }).then(responseBody),
        catch: (error): SqliteHttpError =>
          isGuestFailure(error) || isMalformedReply(error) ? error : new SqliteDisconnected(),
      }).pipe(
        Effect.timeoutFail({
          duration: RESPONSE_TIMEOUT,
          onTimeout: () => new SqliteDisconnected(),
        }),
        Effect.tapError(() => close),
        Effect.onInterrupt(() => close),
      );
    }
    function open(path: GuestPath) {
      return serial.withPermits(1)(
        Effect.gen(function* () {
          if (prefix !== undefined) {
            return yield* new InvalidSqliteRequest();
          }
          prefix = `/sqlite/${encodeURIComponent(path)}/v2`;
          yield* exchange({ method: 'GET', path: prefix, body: '' });
        }),
      );
    }
    function pipeline(body: HranaPipelineReqBody) {
      return serial.withPermits(1)(
        Effect.gen(function* () {
          if (prefix === undefined) {
            return yield* new InvalidSqliteRequest();
          }
          const parsed = yield* Effect.try({
            try: () => parseHranaPipeline(body),
            catch: () => new InvalidSqliteRequest(),
          });
          const encoded = JSON.stringify(parsed);
          if (Buffer.byteLength(encoded) > SQLITE_MAX_REQUEST_BYTES) {
            return yield* new InvalidSqliteRequest();
          }
          const bytes = yield* exchange({
            method: 'POST',
            path: `${prefix}/pipeline`,
            body: encoded,
          });
          return yield* Effect.try({
            try: (): HranaPipelineRespBody => {
              const result = parseHranaPipelineResponse({
                body: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
                requestCount: parsed.requests.length,
              });
              if (result.base_url !== null) {
                throw new MalformedSqliteReply();
              }
              return result;
            },
            catch: () => new MalformedSqliteReply(),
          }).pipe(Effect.onError(() => close));
        }),
      );
    }
    return { open, pipeline, close };
  });
}
