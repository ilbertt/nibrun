import type { AppId } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import type { OwnerId } from '#lib/api/identifiers.ts';
import type { TrustedWorkflow } from '#lib/api/trusted-workflow.ts';
import { Repository } from '#repositories/repository.ts';

export type TrustedWorkflowRow = Queries['SelectTrustedWorkflow'];
type OwnedApp = { appId: AppId; ownerId: OwnerId };
export type SaveTrustedWorkflowInput = OwnedApp & { workflow: TrustedWorkflow };

export abstract class TrustedWorkflowsRepositoryContract {
  abstract find(input: OwnedApp): Promise<TrustedWorkflowRow | null>;
  abstract save(input: SaveTrustedWorkflowInput): Promise<TrustedWorkflowRow | null>;
  abstract remove(input: OwnedApp): Promise<boolean>;
}

export class TrustedWorkflowsRepository
  extends Repository
  implements TrustedWorkflowsRepositoryContract
{
  async find({ appId, ownerId }: OwnedApp): Promise<TrustedWorkflowRow | null> {
    const [row] = await this.sql.SelectTrustedWorkflow`
      SELECT w.repository, w.workflow, w.branch, w.environment
      FROM nibrun.github_trusted_deployment_workflows w
      JOIN nibrun.live_apps a ON a.id = w.app_id
      WHERE w.app_id = ${appId} AND a.owner_id = ${ownerId}
    `;
    return row ?? null;
  }

  async save({
    appId,
    ownerId,
    workflow,
  }: SaveTrustedWorkflowInput): Promise<TrustedWorkflowRow | null> {
    const [row] = await this.sql.UpsertTrustedWorkflow`
      INSERT INTO nibrun.github_trusted_deployment_workflows AS w (app_id, repository, workflow, branch, environment)
      SELECT a.id, ${workflow.repository}, ${workflow.workflow}, ${workflow.branch}, ${workflow.environment}
      FROM nibrun.live_apps a
      WHERE a.id = ${appId} AND a.owner_id = ${ownerId}
      ON CONFLICT (app_id) DO UPDATE SET
        repository = EXCLUDED.repository, workflow = EXCLUDED.workflow,
        branch = EXCLUDED.branch, environment = EXCLUDED.environment
      WHERE EXISTS (
        SELECT 1 FROM nibrun.live_apps a WHERE a.id = w.app_id AND a.owner_id = ${ownerId}
      )
      RETURNING repository, workflow, branch, environment
    `;
    return row ?? null;
  }

  async remove({ appId, ownerId }: OwnedApp): Promise<boolean> {
    const rows = await this.sql.DeleteTrustedWorkflow`
      DELETE FROM nibrun.github_trusted_deployment_workflows w USING nibrun.live_apps a
      WHERE w.app_id = ${appId} AND a.id = w.app_id AND a.owner_id = ${ownerId}
      RETURNING w.id
    `;
    return rows.length > 0;
  }
}
