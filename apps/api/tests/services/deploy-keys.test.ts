import { describe, expect, test } from 'bun:test';
import { schema } from '#db/queries.gen.ts';
import { BadRequestError, ConflictError, NotFoundError } from '#lib/errors.ts';
import type {
  AddDeployKeyInput,
  DeployKeyRow,
  DeployKeysRepositoryContract,
} from '#repositories/deploy-keys.repository.ts';
import { DeployKeysService } from '#services/deploy-keys.service.ts';
import { APP_ID, OWNER_ID } from '#tests/services/support/fixtures.ts';
import {
  DEPLOY_KEY_FINGERPRINT,
  DEPLOY_KEY_ID,
  DEPLOY_PUBLIC_KEY,
  deployKeyRow,
} from '#tests/support/deploy-key.ts';
import { uniqueViolation } from '#tests/support/postgres.ts';

class StubDeployKeysRepository implements DeployKeysRepositoryContract {
  inserted: AddDeployKeyInput | undefined;
  row: DeployKeyRow | null = deployKeyRow();
  refusal: Error | undefined;
  removed = true;

  insert(input: AddDeployKeyInput): Promise<DeployKeyRow | null> {
    this.inserted = input;
    return this.refusal ? Promise.reject(this.refusal) : Promise.resolve(this.row);
  }

  listByApp(): Promise<DeployKeyRow[]> {
    return Promise.resolve(this.row ? [this.row] : []);
  }

  remove(): Promise<boolean> {
    return Promise.resolve(this.removed);
  }
}

function build(ownsApp = true) {
  const keysRepo = new StubDeployKeysRepository();
  const service = new DeployKeysService({
    keysRepo,
    appsRepo: { isOwnedBy: () => Promise.resolve(ownsApp) },
  });
  return { service, keysRepo };
}

const OWNED = { appId: APP_ID, ownerId: OWNER_ID };
const ADD = { ...OWNED, name: 'GitHub Actions', publicKey: DEPLOY_PUBLIC_KEY };

describe('deploy key management', () => {
  test('stores only the normalized public key and derives the fingerprint', async () => {
    const { service, keysRepo } = build();
    const key = await service.add({
      ...ADD,
      name: ` ${ADD.name} `,
      publicKey: `${ADD.publicKey} ci`,
    });

    expect(keysRepo.inserted).toEqual(ADD);
    expect(key.fingerprint).toBe(DEPLOY_KEY_FINGERPRINT);
  });

  test('invalid public keys never reach storage', async () => {
    const { service, keysRepo } = build();

    await expect(service.add({ ...ADD, publicKey: 'not a key' })).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(keysRepo.inserted).toBeUndefined();
  });

  test('a missing app is refused', async () => {
    const { service, keysRepo } = build();
    keysRepo.row = null;

    await expect(service.add(ADD)).rejects.toBeInstanceOf(NotFoundError);
  });

  test('an app outside the owner scope cannot be listed', async () => {
    await expect(build(false).service.list(OWNED)).rejects.toBeInstanceOf(NotFoundError);
  });

  test('only the duplicate-key constraint is translated into a conflict', async () => {
    const { service, keysRepo } = build();
    keysRepo.refusal = uniqueViolation(
      schema.deploy_keys._constraints.deploy_keys_app_public_key_key._constraintName,
    );
    await expect(service.add(ADD)).rejects.toBeInstanceOf(ConflictError);

    keysRepo.refusal = uniqueViolation('some_other_constraint');
    await expect(service.add(ADD)).rejects.toBe(keysRepo.refusal);
  });

  test('revoking a key outside the owner scope is refused', async () => {
    const { service, keysRepo } = build();
    keysRepo.removed = false;

    await expect(service.remove({ ...OWNED, deployKeyId: DEPLOY_KEY_ID })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
