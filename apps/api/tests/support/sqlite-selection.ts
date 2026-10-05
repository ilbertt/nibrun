import type { AppId, DeploymentId, GuestPath, OwnerId } from '@repo/protocol';
import type { DeploymentRow, DeploymentsByAppInput } from '#repositories/deployments.repository.ts';
import {
  A_DEPLOYMENT_ROW,
  APP_ID,
  DEPLOYMENT_ID,
  OWNER_ID,
} from '#tests/services/support/fixtures.ts';
import { RecordingSqliteExecutor } from '#tests/support/hrana/executor.ts';

type OpenInput = { appId: AppId; deploymentId: DeploymentId; path: GuestPath; signal: AbortSignal };

export function sqliteSelectionFixture() {
  const deployment: DeploymentRow = {
    ...A_DEPLOYMENT_ROW,
    id: DEPLOYMENT_ID,
    app_id: APP_ID,
    state: 'running',
  };
  const asked: DeploymentsByAppInput[] = [];
  const opened: OpenInput[] = [];
  const executors: RecordingSqliteExecutor[] = [];
  return {
    deployment,
    asked,
    opened,
    executors,
    baseUrl: new URL('https://api.test'),
    deploymentsRepo: {
      listByApp(input: DeploymentsByAppInput) {
        asked.push(input);
        return Promise.resolve(
          input.ownerId === OWNER_ID && input.appId === APP_ID ? [deployment] : [],
        );
      },
      findById(input: { appId: AppId; deploymentId: DeploymentId; ownerId: OwnerId }) {
        return Promise.resolve(
          input.ownerId === OWNER_ID &&
            input.appId === APP_ID &&
            input.deploymentId === DEPLOYMENT_ID
            ? deployment
            : null,
        );
      },
    },
    openExecutor(input: OpenInput) {
      opened.push(input);
      const executor = new RecordingSqliteExecutor();
      executors.push(executor);
      return Promise.resolve(executor);
    },
  };
}
