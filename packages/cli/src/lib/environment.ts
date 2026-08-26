import { InvalidEnvironmentError, parseEnvironment } from '@repo/app-operations';
import type { TenantEnvironmentPatch } from '@repo/protocol';
import { UsageError } from '#lib/errors.ts';

/**
 * Undefined where neither flag was given, which is what leaves the app's environment alone: an
 * empty edit would be a request to change nothing, sent on every release that mentions none.
 *
 * The shared parser does not know what a command line is, so what it refuses is reported here in
 * the words `nib` refuses anything else in.
 */
export function environmentEdit({
  env = [],
  unset = [],
}: {
  env?: string[] | undefined;
  unset?: string[] | undefined;
}): TenantEnvironmentPatch | undefined {
  if (env.length === 0 && unset.length === 0) {
    return undefined;
  }

  try {
    return parseEnvironment({ set: env, remove: unset });
  } catch (failure) {
    if (failure instanceof InvalidEnvironmentError) {
      throw new UsageError(failure.message);
    }
    throw failure;
  }
}
