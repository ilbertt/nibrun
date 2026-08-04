import type { ProtocolValidationError } from '@repo/protocol';
import { Effect } from 'effect';

export const decode = <A>(parse: () => A) =>
  Effect.try({ try: parse, catch: (cause) => cause as ProtocolValidationError });
