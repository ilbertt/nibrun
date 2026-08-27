import { operationRefusal } from '@repo/app-operations';
import { useApp } from '#lib/hooks/use-app.ts';
import { useAppStatus } from '#lib/hooks/use-app-status.ts';
import { useNewestDeployment } from '#lib/hooks/use-newest-deployment.ts';

/**
 * Whether an app's files can be browsed at all, and what stands in their place when they cannot.
 *
 * `browsable` is also what a page waiting on either answer gets: neither reason is known until the
 * app and its release have been read, and a browse that has not started yet says so for itself.
 */
export type FilesystemAvailability =
  | { readonly kind: 'browsable' }
  | { readonly kind: 'unreadable'; readonly reason: string };

const BROWSABLE: FilesystemAvailability = { kind: 'browsable' };

/**
 * A directory is read inside the microVM that has the volume mounted, so an app running none has
 * nothing to answer a browse with. Decided here rather than waited for, because the api holds the
 * request open for half a minute in the hope of a host that is never going to poll — and what
 * comes back then names neither the app nor why.
 *
 * Which states those are is the table every surface asks, so the tab is not the place a state
 * added later is found to be missing.
 */
export function useFilesystemAvailability(appId: string): FilesystemAvailability {
  const app = useApp(appId);
  const status = useAppStatus(app.data).status;
  const newest = useNewestDeployment(appId);

  if (app.data === undefined || status === undefined) {
    return BROWSABLE;
  }
  const refusal = operationRefusal({
    status,
    operation: 'files',
    slug: app.data.slug,
    release: newest.data,
  });
  return refusal === undefined ? BROWSABLE : { kind: 'unreadable', reason: refusal };
}
