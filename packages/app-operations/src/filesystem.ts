import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';
import { type DirectoryListing, type GuestPath, GuestPathSchema, Value } from '@repo/protocol';
import { describeUnservedDeployment, type SettledDeployment } from '#deploy.ts';
import { InvalidPathError } from '#errors.ts';

/**
 * What was typed, as a path the api will take.
 *
 * A path here is absolute because there is nothing for it to be relative to — the volume's root
 * is the only place it can start — so a leading slash is spelling rather than meaning, and one
 * left off is supplied rather than refused. A trailing one is the same. Nothing else is repaired:
 * `.` and `..` are refused by the schema on purpose, and resolving them here is exactly what
 * would put a caller outside the filesystem they were scoped to.
 */
export function guestPath(typed: string): GuestPath {
  const absolute = typed.startsWith('/') ? typed : `/${typed}`;
  const spelled = absolute.length > 1 ? absolute.replace(/\/$/, '') : absolute;
  try {
    return Value.Parse(GuestPathSchema, spelled);
  } catch {
    throw new InvalidPathError(`${typed} is not a path inside an app filesystem.`);
  }
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

/**
 * Why this app's filesystem cannot be read, when it cannot.
 *
 * A directory is read inside the microVM that has the volume mounted, so an app running none has
 * nothing to answer a read with. Asking anyway costs a wait on a host to be told the same thing in
 * worse words: what comes back names no release and no reason, because a host cannot tell a
 * directory that is not there from a device it could not reach.
 *
 * The newest release decides it rather than the one a caller addressed. The volume outlives every
 * release of it, so a superseded deployment is a perfectly good handle on a filesystem something
 * newer is still mounting — what matters is whether anything is mounting it now.
 *
 * Only a failed release is answered here. One still coming up is worth the wait, and a stopped one
 * belongs to a suspended app, which is an owner's own doing and reads as such where they did it.
 */
export function describeUnreadableFilesystem(newest: SettledDeployment): string | undefined {
  return newest.state === 'failed' ? describeUnservedDeployment(newest) : undefined;
}
