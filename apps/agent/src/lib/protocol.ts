import { ProtocolValidationError } from '@repo/protocol';
import { Data, Effect } from 'effect';

/**
 * `@repo/protocol` throws a plain `Error`, because its schemas are shared with the api and the
 * api does not speak Effect. Tagging it here is what lets a caller match it by `_tag` alongside
 * every other failure rather than reach for `instanceof`.
 */
export class ProtocolMismatch extends Data.TaggedError('ProtocolMismatch')<{
  readonly issues: unknown;
}> {
  override get message() {
    return 'a peer sent a message that does not match the protocol';
  }
}

export const decode = <A>(parse: () => A) =>
  Effect.try({
    try: parse,
    catch: (cause) =>
      new ProtocolMismatch({
        issues: cause instanceof ProtocolValidationError ? cause.issues : cause,
      }),
  });
