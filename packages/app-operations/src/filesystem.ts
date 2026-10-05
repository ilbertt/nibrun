import type { DirectoryListing, GuestPath } from '@repo/api-client/models';
import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';
import { InvalidPathError } from '#errors.ts';

const SPACE_CODE = 32;
export const GUEST_PATH_ROOT = '/';

/**
 * What was typed, as a path the api will take.
 *
 * A path here is absolute because there is nothing for it to be relative to — the volume's root
 * is the only place it can start — so a leading slash is spelling rather than meaning, and one
 * left off is supplied rather than refused. A trailing one is the same. Nothing else is repaired:
 * `.` and `..` are refused, and resolving them here is exactly what
 * would put a caller outside the filesystem they were scoped to.
 */
export function guestPath(typed: string): GuestPath {
  const absolute = typed.startsWith('/') ? typed : `/${typed}`;
  const spelled = absolute.length > 1 ? absolute.replace(/\/$/, '') : absolute;
  if (
    spelled.split('/').some((segment) => segment === '.' || segment === '..') ||
    /[\\"']/.test(spelled) ||
    [...spelled].some((character) => character.charCodeAt(0) < SPACE_CODE) ||
    spelled.includes('//')
  ) {
    throw new InvalidPathError(`${typed} is not a path inside an app filesystem.`);
  }
  return spelled;
}

export async function readDirectory({
  api,
  appId,
  deploymentId,
  path,
}: {
  api: PublicApiClient;
  appId: string;
  deploymentId: string;
  path: GuestPath;
}): Promise<DirectoryListing> {
  return unwrap(
    await api.api.apps({ appId }).deployments({ deploymentId }).filesystem.get({ query: { path } }),
  );
}
