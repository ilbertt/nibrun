import { Elysia } from 'elysia';
import { sql } from '#db/client.ts';
import { env } from '#lib/env.ts';
import { createLogger } from '#lib/logger.ts';
import { AgentRepository } from '#repositories/agent.repository.ts';
import { AssetsRepository } from '#repositories/assets.repository.ts';
import { FilesystemRepository } from '#repositories/filesystem.repository.ts';
import { HealthRepository } from '#repositories/health.repository.ts';
import { AgentService } from '#services/agent.service.ts';
import { AssetsService } from '#services/assets.service.ts';
import { FilesystemService } from '#services/filesystem.service.ts';
import { HealthService } from '#services/health.service.ts';

const agentRepository = new AgentRepository(sql);
const assetsRepository = new AssetsRepository(sql);
const healthRepository = new HealthRepository(sql);
const filesystemRepository = new FilesystemRepository(sql);

const agentService = new AgentService({ agentRepo: agentRepository });
const assetsService = new AssetsService(assetsRepository);
const healthService = new HealthService(healthRepository);
const filesystemService = new FilesystemService({ filesystemRepo: filesystemRepository });

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

export const FilesystemServicePlugin = new Elysia({ name: 'service.filesystem' }).decorate(
  'filesystemService',
  filesystemService,
);
