import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';
import { z } from 'zod';
import { defineOutput } from '#lib/output.ts';

export const SQLITE_CONNECTION_REMOVED_OUTPUT = defineOutput({
  schema: z.object({ appId: z.string(), connectionId: z.string(), deleted: z.literal(true) }),
  render: function render({ value, out }) {
    out.done(`Removed SQLite connection ${value.connectionId} from app ${value.appId}.`);
  },
});

export async function removeSqliteConnection({
  api,
  appId,
  connectionId,
}: {
  api: PublicApiClient;
  appId: string;
  connectionId: string;
}) {
  const removed = unwrap(
    await api.api.apps({ appId }).sqlite.connections({ connectionId }).delete(),
  );
  return { appId, connectionId, ...removed };
}
