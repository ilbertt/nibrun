import { describeUnreadableFilesystem } from '@repo/app-operations';
import { useApp } from '#lib/hooks/use-app.ts';
import { useNewestDeployment } from '#lib/hooks/use-newest-deployment.ts';

/**
 * Whether an app's files can be browsed at all, and what stands in their place when they cannot.
 *
 * `browsable` is also what a page waiting on either answer gets: neither reason is known until the
 * app and its release have been read, and a browse that has not started yet says so for itself.
 */
export type FilesystemAvailability =
  | { readonly kind: 'browsable' }
  | { readonly kind: 'suspended' }
  | { readonly kind: 'unreadable'; readonly reason: string };

const BROWSABLE: FilesystemAvailability = { kind: 'browsable' };
const SUSPENDED: FilesystemAvailability = { kind: 'suspended' };

/**
 * A directory is read inside the microVM that has the volume mounted, so an app running none has
 * nothing to answer a browse with. Decided here rather than waited for, because what a host
 * reports for this is deliberately vague — a directory that could not be read is the same sentence
 * whether the app is down or the device is broken — while the release that never came up kept the
 * reason it didn't.
 *
 * Suspension is read off the app row rather than the release: an app whose microVM has not stopped
 * yet is one that is about to, and offering a browse for the seconds it has left is worse than
 * saying it is suspended a moment early.
 */
export function useFilesystemAvailability(appId: string): FilesystemAvailability {
  const app = useApp(appId);
  const newest = useNewestDeployment(appId);

  if (app.data?.state === 'suspended') {
    return SUSPENDED;
  }
  const reason = newest.data === undefined ? undefined : describeUnreadableFilesystem(newest.data);
  return reason === undefined ? BROWSABLE : { kind: 'unreadable', reason };
}
