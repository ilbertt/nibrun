import { type HostId, LOG_STREAM_FIELDS } from '@repo/protocol';
import { Data, Effect } from 'effect';
import { type TenantLogEvent, tenantLogRecord } from '#lib/logs/event.ts';

const INSERT_PATH = '/insert/jsonline';
/** The store's own name for newline-delimited JSON; it does not answer to x-ndjson here. */
const CONTENT_TYPE = 'application/stream+json';
const UPLOAD_TIMEOUT_MS = 30_000;
const OK_MIN = 200;
const OK_MAX = 300;
const NOT_DELIVERED = 0;
const MAX_BODY = 256;

export class LogStoreError extends Data.TaggedError('LogStoreError')<{
  readonly status: number;
  readonly body: string;
}> {
  override get message() {
    return this.status === NOT_DELIVERED
      ? `the log store was not reached: ${this.body}`
      : `the log store answered ${this.status}: ${this.body}`;
  }
}

export type LogStoreClient = {
  readonly publish: (input: {
    readonly events: readonly TenantLogEvent[];
    readonly hostId: HostId;
  }) => Effect.Effect<void, LogStoreError>;
};

/**
 * Writes tenant output to the log store, over a port that admits app hosts and nothing else.
 *
 * It never reads. A query decides who may see an app, which is the api's to answer and not
 * something a host should be able to ask — so nothing here needs `/select`.
 */
export function makeLogStoreClient({ baseUrl }: { baseUrl: string }): LogStoreClient {
  const url = new URL(INSERT_PATH, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  // Declared per request rather than configured on the store, so the fields that key a stream
  // travel with the records that use them and cannot drift out of step with the schema.
  url.searchParams.set('_stream_fields', LOG_STREAM_FIELDS.join(','));
  url.searchParams.set('_time_field', '_time');
  url.searchParams.set('_msg_field', '_msg');
  const insertUrl = url.toString();

  return {
    publish: ({ events, hostId }) =>
      Effect.gen(function* () {
        if (events.length === 0) {
          return;
        }
        const body = events
          .map((event) => `${JSON.stringify(tenantLogRecord({ event, hostId }))}\n`)
          .join('');

        const response = yield* Effect.tryPromise({
          try: (signal) =>
            fetch(insertUrl, {
              method: 'POST',
              headers: { 'content-type': CONTENT_TYPE },
              body,
              signal,
            }),
          catch: (cause) =>
            new LogStoreError({ status: NOT_DELIVERED, body: describeFailure(cause) }),
        }).pipe(Effect.timeout(UPLOAD_TIMEOUT_MS), Effect.catchTag('TimeoutException', timedOut));

        if (response.status < OK_MIN || response.status >= OK_MAX) {
          const detail = yield* Effect.orElseSucceed(
            Effect.tryPromise(() => response.text()),
            () => '',
          );
          return yield* new LogStoreError({
            status: response.status,
            body: detail.slice(0, MAX_BODY),
          });
        }
      }),
  };
}

const timedOut = () =>
  new LogStoreError({ status: NOT_DELIVERED, body: `no answer within ${UPLOAD_TIMEOUT_MS}ms` });

const describeFailure = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);
