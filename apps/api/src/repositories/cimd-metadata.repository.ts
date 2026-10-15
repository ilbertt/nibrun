import { fetchClientMetadataResource } from '@better-auth/cimd/node';

type MetadataFetchInput = {
  input: Parameters<typeof fetchClientMetadataResource>[0];
  init: Parameters<typeof fetchClientMetadataResource>[1];
};

export abstract class CimdMetadataRepositoryContract {
  abstract fetch(input: MetadataFetchInput): Promise<Response>;
}

export class CimdMetadataRepository implements CimdMetadataRepositoryContract {
  async fetch({ input, init }: MetadataFetchInput): Promise<Response> {
    return await fetchClientMetadataResource(input, init);
  }
}
