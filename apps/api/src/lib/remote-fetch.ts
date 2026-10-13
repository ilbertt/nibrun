import type { OwnerId } from '#lib/api/identifiers.ts';
import { TooManyRequestsError } from '#lib/errors.ts';
import { withoutCredentials } from '#lib/remote-url.ts';
import type { RemoteSource } from '#repositories/remote-source.repository.ts';

export const MAX_CONCURRENT_FETCHES = 8;
export const MAX_CONCURRENT_FETCHES_PER_OWNER = 3;

export class RemoteFetchSlots {
  private inFlight = 0;
  private readonly byOwner = new Map<OwnerId, number>();

  take(ownerId: OwnerId): void {
    const own = this.byOwner.get(ownerId) ?? 0;
    if (own >= MAX_CONCURRENT_FETCHES_PER_OWNER) {
      throw new TooManyRequestsError(
        `This account is already fetching ${MAX_CONCURRENT_FETCHES_PER_OWNER} files. Wait for one to finish, then try again.`,
      );
    }
    if (this.inFlight >= MAX_CONCURRENT_FETCHES) {
      throw new TooManyRequestsError(
        'nibrun is fetching as many files as it will at once. Try again in a moment.',
      );
    }
    this.inFlight += 1;
    this.byOwner.set(ownerId, own + 1);
  }

  release(ownerId: OwnerId): void {
    this.inFlight -= 1;
    const own = (this.byOwner.get(ownerId) ?? 1) - 1;
    if (own <= 0) {
      this.byOwner.delete(ownerId);
    } else {
      this.byOwner.set(ownerId, own);
    }
  }
}

export function sourceRefusal({
  url,
  source,
}: {
  url: string;
  source: Exclude<RemoteSource, { outcome: 'open' }>;
}): string {
  switch (source.outcome) {
    case 'unreachable':
      return `The url could not be reached from nibrun: ${url}`;
    case 'refused':
      return `The url answered ${source.status}, so there was nothing to deploy: ${url}`;
    case 'empty':
      return 'The url answered with no body.';
    case 'insecure-redirect':
      return `The url redirected to ${withoutCredentials(source.to)}, which is not an https address nibrun will follow.`;
    case 'too-many-redirects':
      return 'The url redirected more times than nibrun will follow.';
    case 'private-address':
      return `${source.host} resolves inside the network nibrun runs in, which is not somewhere it will fetch from.`;
  }
}
