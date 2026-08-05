import type { AppId, FilesystemQuery, FilesystemQueryId, GuestPath } from '@repo/protocol';
import { GUEST_PATH_ROOT } from '@repo/protocol';
import { Repository } from '#repositories/repository.ts';

const POCKETBASE = 'app-pocketbase' as AppId;

// Written out here for the same reason the desired app in `agent.repository.ts` is: there is no
// table to read them from yet. Two paths rather than one, because the root answers whether a
// device can be read at all and never changes again — only a directory the tenant's binary keeps
// writing to can say whether what comes back is current.
const STANDING_QUERIES = [
  {
    queryId: 'query-pocketbase-root' as FilesystemQueryId,
    appId: POCKETBASE,
    path: GUEST_PATH_ROOT,
  },
  {
    queryId: 'query-pocketbase-data' as FilesystemQueryId,
    appId: POCKETBASE,
    path: '/pb_data' as GuestPath,
  },
] satisfies FilesystemQuery[];

export class FilesystemRepository extends Repository {
  pendingQueries(): Promise<readonly FilesystemQuery[]> {
    return Promise.resolve(STANDING_QUERIES);
  }
}
