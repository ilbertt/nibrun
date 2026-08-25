import { DirectoryListing } from '#components/files/directory-listing.tsx';
import { SuspendedFilesystem } from '#components/files/suspended-filesystem.tsx';
import { useApp } from '#lib/hooks/use-app.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';

/**
 * A directory is read inside the microVM that has the volume mounted, so a suspended app has
 * nothing to answer with and a browse can only fail. Said here rather than waited for, because
 * what a host reports for this is deliberately vague — a directory that could not be read is the
 * same sentence whether the app is down or the device is broken.
 *
 * Read off the app row rather than the release: an app whose microVM has not stopped yet is one
 * that is about to, and offering a browse for the seconds it has left is worse than saying it is
 * suspended a moment early.
 */
export function DirectoryBrowser() {
  const appId = useAppId();
  const app = useApp(appId);

  return app.data?.state === 'suspended' ? <SuspendedFilesystem /> : <DirectoryListing />;
}
