import type { DeployKey } from '@repo/protocol';
import { schema } from '#db/queries.gen.ts';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import { isUniqueViolation } from '#lib/pg-errors.ts';
import { parseSshPublicKey } from '#lib/ssh-public-key.ts';
import { toTimestamp } from '#lib/timestamp.ts';
import type { AppsRepositoryContract } from '#repositories/apps.repository.ts';
import type {
  AddDeployKeyInput,
  DeployKeyRow,
  DeployKeysRepositoryContract,
  OwnedDeployKeys,
  RemoveDeployKeyInput,
} from '#repositories/deploy-keys.repository.ts';
import { Service } from '#services/service.ts';

const DUPLICATE_KEY_CONSTRAINT =
  schema.deploy_keys._constraints.deploy_keys_app_public_key_key._constraintName;

export class DeployKeysService extends Service {
  private readonly keysRepo: DeployKeysRepositoryContract;
  private readonly appsRepo: Pick<AppsRepositoryContract, 'isOwnedBy'>;

  constructor({
    keysRepo,
    appsRepo,
  }: {
    keysRepo: DeployKeysRepositoryContract;
    appsRepo: Pick<AppsRepositoryContract, 'isOwnedBy'>;
  }) {
    super();
    this.keysRepo = keysRepo;
    this.appsRepo = appsRepo;
  }

  async add({ publicKey, name, ...owned }: AddDeployKeyInput): Promise<DeployKey> {
    const parsed = parseSshPublicKey(publicKey);
    const row = await this.keysRepo
      .insert({ ...owned, name: name.trim(), publicKey: parsed.publicKey })
      .catch((error: unknown) => {
        if (isUniqueViolation({ error, constraint: DUPLICATE_KEY_CONSTRAINT })) {
          throw new ConflictError('This public key is already registered for this app.');
        }
        throw error;
      });
    if (!row) {
      throw new NotFoundError('App not found.');
    }
    return toDeployKey(row);
  }

  async list(owned: OwnedDeployKeys): Promise<DeployKey[]> {
    if (!(await this.appsRepo.isOwnedBy(owned))) {
      throw new NotFoundError('App not found.');
    }
    return (await this.keysRepo.listByApp(owned)).map(toDeployKey);
  }

  async remove(input: RemoveDeployKeyInput): Promise<void> {
    if (!(await this.keysRepo.remove(input))) {
      throw new NotFoundError('Deploy key not found.');
    }
  }
}

function toDeployKey(row: DeployKeyRow): DeployKey {
  return {
    id: row.id,
    appId: row.app_id,
    name: row.name,
    ...parseSshPublicKey(row.public_key),
    createdAt: toTimestamp(row.created_at),
  };
}
