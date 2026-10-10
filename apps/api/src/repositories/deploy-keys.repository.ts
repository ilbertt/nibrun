import type { AppId } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import type { DeployKeyId, OwnerId } from '#lib/api/identifiers.ts';
import { Repository } from '#repositories/repository.ts';

export type DeployKeyRow = Queries['SelectDeployKeysByApp'];
export type OwnedDeployKeys = { appId: AppId; ownerId: OwnerId };
export type AddDeployKeyInput = OwnedDeployKeys & { name: string; publicKey: string };
export type RemoveDeployKeyInput = OwnedDeployKeys & { deployKeyId: DeployKeyId };

export abstract class DeployKeysRepositoryContract {
  abstract insert(input: AddDeployKeyInput): Promise<DeployKeyRow | null>;
  abstract listByApp(input: OwnedDeployKeys): Promise<DeployKeyRow[]>;
  abstract remove(input: RemoveDeployKeyInput): Promise<boolean>;
}

export class DeployKeysRepository extends Repository implements DeployKeysRepositoryContract {
  async insert({
    appId,
    ownerId,
    name,
    publicKey,
  }: AddDeployKeyInput): Promise<DeployKeyRow | null> {
    const [row] = await this.sql.InsertDeployKey`
      INSERT INTO nibrun.deploy_keys (app_id, name, public_key)
      SELECT a.id, ${name}, ${publicKey}
      FROM nibrun.live_apps a
      WHERE a.id = ${appId} AND a.owner_id = ${ownerId} AND a.state <> 'deleting'
      RETURNING id, app_id, name, public_key, created_at
    `;
    return row ?? null;
  }

  listByApp({ appId, ownerId }: OwnedDeployKeys): Promise<DeployKeyRow[]> {
    return this.sql.SelectDeployKeysByApp`
      SELECT k.id, k.app_id, k.name, k.public_key, k.created_at
      FROM nibrun.deploy_keys k
      JOIN nibrun.live_apps a ON a.id = k.app_id
      WHERE k.app_id = ${appId} AND a.owner_id = ${ownerId}
      ORDER BY k.id DESC
    `;
  }

  async remove({ appId, ownerId, deployKeyId }: RemoveDeployKeyInput): Promise<boolean> {
    const [row] = await this.sql.DeleteDeployKey`
      DELETE FROM nibrun.deploy_keys k
      USING nibrun.live_apps a
      WHERE k.id = ${deployKeyId} AND k.app_id = ${appId} AND a.id = k.app_id
        AND a.owner_id = ${ownerId}
      RETURNING k.id
    `;
    return row !== undefined;
  }
}
