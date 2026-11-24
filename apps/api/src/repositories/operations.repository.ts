import type { TypedSQL } from '@ilbertt/bun-sqlgen';
import type { AppId, DeploymentId } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import type { OperationAttribution } from '#lib/operation-client.ts';

type AppOperation =
  | {
      action:
        | 'app.created'
        | 'app.updated'
        | 'app.environment.updated'
        | 'app.suspended'
        | 'app.resumed'
        | 'app.deletion.requested';
    }
  | {
      action: 'deployment.requested' | 'deployment.rollback.requested';
      deploymentId: DeploymentId;
    };

export async function recordAppOperation(
  input: OperationAttribution &
    AppOperation & {
      tx: TypedSQL<Queries>;
      appId: AppId;
    },
): Promise<void> {
  const { tx, action, client, appId } = input;
  const deploymentId = 'deploymentId' in input ? input.deploymentId : null;
  await tx.InsertAppOperation`
    INSERT INTO nibrun.operations (action, client, app_id, deployment_id)
    VALUES (${action}, ${client}, ${appId}, ${deploymentId})
  `;
}
