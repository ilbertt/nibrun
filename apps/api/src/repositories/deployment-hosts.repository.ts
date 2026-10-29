import type { AppId, DeploymentId, HostId } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { Repository } from '#repositories/repository.ts';

export type CurrentAppExecution = Queries['SelectCurrentAppExecution'];

export abstract class DeploymentHostsRepositoryContract {
  abstract hostForExecution(input: {
    appId: AppId;
    deploymentId: DeploymentId;
  }): Promise<HostId | undefined>;
  abstract currentForApp(input: {
    appId: AppId;
    ownerId: OwnerId;
  }): Promise<CurrentAppExecution | null>;
}

export class DeploymentHostsRepository
  extends Repository
  implements DeploymentHostsRepositoryContract
{
  // Public request authorization precedes this internal execution-routing lookup.
  async hostForExecution({
    appId,
    deploymentId,
  }: {
    appId: AppId;
    deploymentId: DeploymentId;
  }): Promise<HostId | undefined> {
    const [row] = await this.sql.SelectExecutionHost`
      SELECT host_id FROM nibrun.app_hosts
      WHERE app_id = ${appId} AND deployment_id = ${deploymentId}
    `;
    return row?.host_id;
  }

  async currentForApp({
    appId,
    ownerId,
  }: {
    appId: AppId;
    ownerId: OwnerId;
  }): Promise<CurrentAppExecution | null> {
    const [row] = await this.sql.SelectCurrentAppExecution`
      SELECT h.deployment_id, h.host_id
      FROM nibrun.app_hosts h
      JOIN nibrun.live_apps a ON a.id = h.app_id
      WHERE a.id = ${appId} AND a.owner_id = ${ownerId}
    `;
    return row ?? null;
  }
}
