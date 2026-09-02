import type { Sha256Digest } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import { Repository } from '#repositories/repository.ts';

export type CachedBinaryRow = Queries['SelectCachedBinary'];

export abstract class CachedBinariesRepositoryContract {
  abstract findBySourceDigest(input: {
    sourceDigest: Sha256Digest;
  }): Promise<CachedBinaryRow | null>;
}

/**
 * The one read here that names no owner, and the only one that must not.
 *
 * What it answers is "has this exact download already been fetched, stored and run", which is a
 * question about bytes rather than about anybody's app — and the bytes are shared already: the
 * store is content-addressed, so two owners deploying the same release have always pointed at one
 * object. Scoping this to the caller would leave that sharing exactly as it is and only make each
 * owner pay for the download separately, which is the cost this exists to remove.
 *
 * A digest is what the caller had to bring to ask, and they had to know it to write it down. What
 * comes back is bytes they were already able to fetch for themselves — so the answer tells them
 * nothing about who else deployed it, and `cached_binaries` leaves out every download that was
 * reached with a password.
 */
export class CachedBinariesRepository
  extends Repository
  implements CachedBinariesRepositoryContract
{
  async findBySourceDigest({
    sourceDigest,
  }: {
    sourceDigest: Sha256Digest;
  }): Promise<CachedBinaryRow | null> {
    const [row] = await this.sql.SelectCachedBinary`
      SELECT source_digest, digest, size_bytes, object_key, original_file_name
      FROM nibrun.cached_binaries
      WHERE source_digest = ${sourceDigest}
      LIMIT 1
    `;
    return row ?? null;
  }
}
