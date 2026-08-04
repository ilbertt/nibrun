import { parseMessage, type TenantLogEvent, TenantLogEventSchema } from '@repo/protocol';
import { BadRequestError } from '#lib/errors.ts';

// The protocol caps one chunk's text far below this, so a line that outgrows it is a body with
// no newlines in it rather than a large event. This request stays open for the life of a host,
// which is long enough for buffering that to be the whole process.
const MAX_LINE_LENGTH = 1_048_576;

const NEWLINE = '\n';

/**
 * The one agent request whose body is a stream rather than a document, so it is decoded here
 * instead of by a route schema. Reading it to its end is what holds the request open: the agent
 * treats a response as the end of the stream and reconnects, so returning early would put it in
 * a reconnect loop rather than stop it sending.
 */
export async function* tenantLogEvents({
  body,
}: {
  body: ReadableStream<Uint8Array> | null;
}): AsyncGenerator<TenantLogEvent> {
  if (!body) {
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      pending += decoder.decode(value, { stream: true });
      for (
        let newline = pending.indexOf(NEWLINE);
        newline >= 0;
        newline = pending.indexOf(NEWLINE)
      ) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.length > 0) {
          yield eventFrom(line);
        }
      }
      if (pending.length > MAX_LINE_LENGTH) {
        throw new BadRequestError('A tenant log line outgrew what one event can be.');
      }
    }
    // Every event the agent writes is newline-terminated, so a remainder is a connection cut
    // mid-line. The events before it were already delivered; the torn one is simply gone.
  } finally {
    reader.releaseLock();
  }
}

function eventFrom(line: string): TenantLogEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new BadRequestError('A tenant log line is not JSON.');
  }
  try {
    return parseMessage({ schema: TenantLogEventSchema, value });
  } catch {
    throw new BadRequestError('A tenant log line is not a tenant log event.');
  }
}
