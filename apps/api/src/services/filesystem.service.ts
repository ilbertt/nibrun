import type { AppId, FilesystemQuery, FilesystemQueryResult } from '@repo/protocol';
import type { FilesystemRepository } from '#repositories/filesystem.repository.ts';
import { Service } from '#services/service.ts';

const LOGGED_ENTRY_NAMES = 10;

export class FilesystemService extends Service {
  private readonly filesystemRepo: FilesystemRepository;
  #handedOut = 0;

  constructor({ filesystemRepo }: { filesystemRepo: FilesystemRepository }) {
    super();
    this.filesystemRepo = filesystemRepo;
  }

  /**
   * One per poll, taken in turn, so every standing query is read as often as the others rather
   * than the first one starving the rest. A poll carries one answer back, and widening it to a
   * batch would make a slow directory delay every other directory's answer.
   *
   * Offered only to a host that says it serves the app. The claim is the host's, restated on each
   * poll: it is the only party that knows what it has attached, and a control plane deciding this
   * from its own records would keep sending reads to a host that no longer holds the volume.
   */
  async pendingQuery({
    servedAppIds,
  }: {
    servedAppIds: readonly AppId[];
  }): Promise<FilesystemQuery | undefined> {
    const queries = (await this.filesystemRepo.pendingQueries()).filter((query) =>
      servedAppIds.includes(query.appId),
    );
    if (queries.length === 0) {
      return undefined;
    }
    const query = queries[this.#handedOut % queries.length];
    this.#handedOut += 1;
    return query;
  }

  /**
   * Logged rather than kept. Nothing is waiting on this yet, so a listing has nowhere to go —
   * what it answers for now is whether a host can read a live tenant filesystem at all.
   */
  acceptResult(result: FilesystemQueryResult): void {
    if (result.outcome.status === 'failed') {
      this.logger.warn('host could not read a directory', {
        queryId: result.queryId,
        message: result.outcome.message,
      });
      return;
    }

    const { listing } = result.outcome;
    this.logger.info('host read a directory', {
      queryId: result.queryId,
      path: listing.path,
      entries: listing.entries.length,
      truncated: listing.truncated,
      // The names are the whole point while this is a smoke test: a count alone cannot tell a
      // directory that was read from one that was not.
      names: listing.entries.slice(0, LOGGED_ENTRY_NAMES).map((entry) => entry.name),
    });
  }
}
