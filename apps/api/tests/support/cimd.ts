import type { CimdMetadataRepositoryContract } from '#repositories/cimd-metadata.repository.ts';

export const cimdDocuments = new Map<string, Record<string, unknown>>();

export const cimdMetadataRepository = {
  fetch({ input }) {
    const url = input instanceof Request ? input.url : input.toString();
    const document = cimdDocuments.get(url);
    return Promise.resolve(
      document ? Response.json(document) : new Response(null, { status: 404 }),
    );
  },
} satisfies CimdMetadataRepositoryContract;
