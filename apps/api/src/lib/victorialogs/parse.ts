/**
 * One record as the store returns it.
 *
 * Every value is a string whatever it was ingested as — the store converts numbers, booleans and
 * arrays on the way in, to keep full-text search over them one kind of thing. So a caller wanting
 * a number back is the one that has to say so; nothing here guesses which fields were ones.
 */
export type LogRow = Record<string, string>;

/**
 * Newline-delimited JSON off a response the store writes as it finds matches, so a record
 * straddling two reads is the ordinary case rather than an edge one: what is left after the last
 * newline is carried into the next chunk instead of being parsed as a line of its own.
 */
export async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffered = '';
  for await (const chunk of body) {
    buffered += decoder.decode(chunk, { stream: true });
    const parts = buffered.split('\n');
    buffered = parts.pop() ?? '';
    for (const part of parts) {
      if (part.length > 0) {
        yield part;
      }
    }
  }
  if (buffered.length > 0) {
    yield buffered;
  }
}

/**
 * A line that is not a JSON object is not a record, and is dropped rather than thrown: a live
 * tail must not end because the store wrote something this client cannot read.
 */
export function toRow(line: string): LogRow | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as LogRow)
      : undefined;
  } catch {
    return undefined;
  }
}
