import type { CimdMetadataRepositoryContract } from '#repositories/cimd-metadata.repository.ts';
import { Service } from '#services/service.ts';

export type CimdMetadataServiceContract = Pick<CimdMetadataService, 'fetch'>;

export class CimdMetadataService extends Service {
  private readonly repository: CimdMetadataRepositoryContract;

  constructor(repository: CimdMetadataRepositoryContract) {
    super();
    this.repository = repository;
  }

  fetch(input: Parameters<CimdMetadataRepositoryContract['fetch']>[0]): Promise<Response> {
    return this.repository.fetch(input);
  }
}
