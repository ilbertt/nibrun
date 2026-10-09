import type { AppId } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import type { OwnerId, TrustedWorkflowId } from '#lib/api/identifiers.ts';
import type { TrustedWorkflow } from '#lib/api/trusted-workflow.ts';
import { Repository } from '#repositories/repository.ts';

export type TrustedWorkflowRow = Queries['SelectTrustedWorkflow'];
export type TrustedWorkflowsByAppInput = { appId: AppId; ownerId: OwnerId };
export type TrustedWorkflowByIdInput = TrustedWorkflowsByAppInput & {
  workflowId: TrustedWorkflowId;
};
export type CreateTrustedWorkflowInput = TrustedWorkflowsByAppInput & { workflow: TrustedWorkflow };
export type UpdateTrustedWorkflowInput = TrustedWorkflowByIdInput & { workflow: TrustedWorkflow };

export abstract class TrustedWorkflowsRepositoryContract {
  abstract find(input: TrustedWorkflowsByAppInput): Promise<TrustedWorkflowRow | null>;
  abstract create(input: CreateTrustedWorkflowInput): Promise<TrustedWorkflowRow | null>;
  abstract update(input: UpdateTrustedWorkflowInput): Promise<TrustedWorkflowRow | null>;
  abstract remove(input: TrustedWorkflowByIdInput): Promise<boolean>;
}

export class TrustedWorkflowsRepository
  extends Repository
  implements TrustedWorkflowsRepositoryContract
{
  async find({ appId, ownerId }: TrustedWorkflowsByAppInput): Promise<TrustedWorkflowRow | null> {
    const [row] = await this.sql.SelectTrustedWorkflow`
      SELECT w.id, w.repository, w.workflow, w.branch, w.environment
      FROM nibrun.github_trusted_deployment_workflows w
      JOIN nibrun.live_apps a ON a.id = w.app_id
      WHERE w.app_id = ${appId} AND a.owner_id = ${ownerId}
    `;
    return row ?? null;
  }

  async create({
    appId,
    ownerId,
    workflow,
  }: CreateTrustedWorkflowInput): Promise<TrustedWorkflowRow | null> {
    const [row] = await this.sql.InsertTrustedWorkflow`
      INSERT INTO nibrun.github_trusted_deployment_workflows (app_id, repository, workflow, branch, environment)
      SELECT a.id, ${workflow.repository}, ${workflow.workflow}, ${workflow.branch}, ${workflow.environment}
      FROM nibrun.live_apps a
      WHERE a.id = ${appId} AND a.owner_id = ${ownerId}
      RETURNING id, repository, workflow, branch, environment
    `;
    return row ?? null;
  }

  async update({
    appId,
    ownerId,
    workflowId,
    workflow,
  }: UpdateTrustedWorkflowInput): Promise<TrustedWorkflowRow | null> {
    const [row] = await this.sql.UpdateTrustedWorkflow`
      UPDATE nibrun.github_trusted_deployment_workflows w
      SET repository = ${workflow.repository}, workflow = ${workflow.workflow},
          branch = ${workflow.branch}, environment = ${workflow.environment}
      FROM nibrun.live_apps a
      WHERE w.id = ${workflowId} AND w.app_id = ${appId}
        AND a.id = w.app_id AND a.owner_id = ${ownerId}
      RETURNING w.id, w.repository, w.workflow, w.branch, w.environment
    `;
    return row ?? null;
  }

  async remove({ appId, ownerId, workflowId }: TrustedWorkflowByIdInput): Promise<boolean> {
    const rows = await this.sql.DeleteTrustedWorkflow`
      DELETE FROM nibrun.github_trusted_deployment_workflows w USING nibrun.live_apps a
      WHERE w.id = ${workflowId} AND w.app_id = ${appId}
        AND a.id = w.app_id AND a.owner_id = ${ownerId}
      RETURNING w.id
    `;
    return rows.length > 0;
  }
}
