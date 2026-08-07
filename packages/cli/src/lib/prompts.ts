import { isCancel } from '@clack/prompts';
import { CancelledError } from '#lib/errors.ts';

/**
 * clack answers a cancelled prompt with a sentinel rather than rejecting, so every answer has to
 * be read through here or a Ctrl-C reaches the api as if it were an instruction.
 */
export function answered<T>(value: T | symbol): T {
  if (isCancel(value)) {
    throw new CancelledError();
  }
  return value as T;
}
