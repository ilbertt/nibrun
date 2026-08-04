import { Elysia } from 'elysia';
import { sql } from '#db/client.ts';
import { createLogger } from '#lib/logger.ts';
import { AgentRepository } from '#repositories/agent.repository.ts';
import { AssetsRepository } from '#repositories/assets.repository.ts';
import { DeploymentRepository } from '#repositories/deployment.repository.ts';
import { HealthRepository } from '#repositories/health.repository.ts';
import { AgentService } from '#services/agent.service.ts';
import { AssetsService } from '#services/assets.service.ts';
import { DeploymentService } from '#services/deployment.service.ts';
import { HealthService } from '#services/health.service.ts';

const agentRepository = new AgentRepository(sql);
const assetsRepository = new AssetsRepository(sql);
const deploymentRepository = new DeploymentRepository(sql);
const healthRepository = new HealthRepository(sql);

const assetsService = new AssetsService(assetsRepository);
const deploymentService = new DeploymentService({ deploymentRepository });
const agentService = new AgentService({ agentRepo: agentRepository, deploymentService });
const healthService = new HealthService(healthRepository);

export function loggerPlugin(name: string) {
  const logger = createLogger(name);
  return new Elysia({ name: `logger.${name}` }).derive({ as: 'scoped' }, () => ({ logger }));
}

export const AssetsServicePlugin = new Elysia({ name: 'service.assets' }).decorate(
  'assetsService',
  assetsService,
);

export const HealthServicePlugin = new Elysia({ name: 'service.health' }).decorate(
  'healthService',
  healthService,
);

export const AgentServicePlugin = new Elysia({ name: 'service.agent' }).decorate(
  'agentService',
  agentService,
);

export const DeploymentServicePlugin = new Elysia({ name: 'service.deployment' })
  .decorate('deploymentService', deploymentService)
  .onStart(() => {
    deploymentService.startDeadlineSweep();
  })
  .onStop(async () => {
    await deploymentService.dispose();
  });
