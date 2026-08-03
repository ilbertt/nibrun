import { type HostVersions, HostVersionsSchema, parseMessage } from '@repo/protocol';
import { readJsonFile } from '#lib/json-store.ts';

export class MissingVersionsError extends Error {
  constructor(path: string) {
    super(`${path} is missing: a host that cannot say what it is running has been misdeployed`);
    this.name = 'MissingVersionsError';
  }
}

/**
 * The pins CI writes into the bundle, read rather than compiled in.
 *
 * The agent's own version is the git SHA of the commit that built it; the other three name the
 * versions installed under `/opt/nibrun/bin`. Reading them from the same file the deploy
 * script installs from is what keeps a report from claiming a version a symlink no longer
 * points at.
 */
export async function readHostVersions({ path }: { path: string }): Promise<HostVersions> {
  const value = await readJsonFile({ path });
  if (value === undefined) {
    throw new MissingVersionsError(path);
  }
  return parseMessage({ schema: HostVersionsSchema, value });
}
