import type { TypedSQL } from '@ilbertt/bun-sqlgen';
import type { Queries } from '#db/queries.gen.ts';
import type { OperationAttribution } from '#lib/operation-client.ts';

export type AppConfigAction = 'app.updated' | 'app.environment.updated';

export async function setOperationContext({
  tx,
  client,
  configAction,
}: OperationAttribution & {
  tx: TypedSQL<Queries>;
  configAction?: AppConfigAction | undefined;
}): Promise<void> {
  await tx.SetOperationContext`
    SELECT set_config('nibrun.operation_client', ${client}, true) AS client,
           set_config('nibrun.app_config_action', ${configAction ?? ''}, true) AS config_action
  `;
}
