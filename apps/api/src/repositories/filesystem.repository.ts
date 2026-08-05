import type { AppId, FilesystemQuery, FilesystemQueryId } from '@repo/protocol';
import { GUEST_PATH_ROOT } from '@repo/protocol';
import { Repository } from '#repositories/repository.ts';

// One query, written out here, for the same reason the desired app in `agent.repository.ts` is:
// there is no table to read it from yet. It is what proves the channel end to end — a host picks
// it up, reads the device and answers — and replacing it is replacing the body of `pendingQuery`.
const STANDING_QUERY = {
  queryId: 'query-pocketbase-root' as FilesystemQueryId,
  appId: 'app-pocketbase' as AppId,
  path: GUEST_PATH_ROOT,
} satisfies FilesystemQuery;

export class FilesystemRepository extends Repository {
  pendingQuery(): Promise<FilesystemQuery> {
    return Promise.resolve(STANDING_QUERY);
  }
}
