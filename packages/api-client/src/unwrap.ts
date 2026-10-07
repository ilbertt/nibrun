export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

type Reply = { data: unknown; error: unknown };

/**
 * Eden hands back a failure rather than rejecting, and reports one it never sent as a 503 of its
 * own — so a refusal and an unreachable api arrive the same way, and both have to be raised here
 * or every call site reads as if it succeeded.
 */
export function unwrap<R extends Reply>(reply: R): NonNullable<R['data']> {
  if (reply.error !== null) {
    throw new ApiError(describeFailure(reply.error));
  }
  return reply.data as NonNullable<R['data']>;
}

/**
 * Eden wraps the body it was given in an `Error` whose message is that body stringified, which
 * for the api's `{ error }` shape reads as `[object Object]`.
 *
 * The status is said as well as the body, because the body alone reads as this program's own
 * verdict: `Not Found` sounds like a binary that could not be opened rather than a route that
 * does not exist.
 */
export function describeFailure(failure: unknown): string {
  if (typeof failure !== 'object' || failure === null || !('value' in failure)) {
    return String(failure);
  }
  const { value } = failure;
  // Eden reports a request it never managed to send as a 503 of its own, so a thrown value is
  // this end failing to reach the api rather than the api answering.
  if (value instanceof Error) {
    return value.message;
  }
  const status = 'status' in failure ? String(failure.status) : 'no status';
  return `The api answered ${status}: ${bodyMessage(value)}`;
}

function bodyMessage(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'error' in value) {
    return String(value.error);
  }
  // Eden can leave chunked error bodies unread. Consuming one would make every caller async
  // just to quote a proxy page, so neither streamed nor buffered HTML is repeated here.
  if (isHtmlPage(value) || isAsyncIterable(value)) {
    return 'an error page instead of an API response';
  }
  return String(value);
}

function isHtmlPage(value: unknown): boolean {
  return typeof value === 'string' && /^\s*(?:<!doctype\s+html\b|<html\b)/i.test(value);
}

function isAsyncIterable(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Symbol.asyncIterator in value;
}
