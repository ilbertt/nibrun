import { Elysia } from 'elysia';
import { sql } from '#db/client.ts';
import { CloudflareClient } from '#lib/cloudflare/client.ts';
import { env } from '#lib/env.ts';
import { createLogger } from '#lib/logger.ts';
import { artifactsS3, artifactsSigner, exportsS3 } from '#lib/s3/client.ts';
import { readSecretsKey } from '#lib/tenant-secrets.ts';
import { VictoriaLogsClient } from '#lib/victorialogs/client.ts';
import { AgentRepository } from '#repositories/agent.repository.ts';
import { AppHostnamesRepository } from '#repositories/app-hostnames.repository.ts';
import { AppsRepository } from '#repositories/apps.repository.ts';
import { ArtifactStorageRepository } from '#repositories/artifact-storage.repository.ts';
import { ArtifactsRepository } from '#repositories/artifacts.repository.ts';
import { AssetsRepository } from '#repositories/assets.repository.ts';
import { BinarySourceRepository } from '#repositories/binary-source.repository.ts';
import { CustomHostnamesRepository } from '#repositories/custom-hostnames.repository.ts';
import { DeploymentsRepository } from '#repositories/deployments.repository.ts';
import { ExportStorageRepository } from '#repositories/export-storage.repository.ts';
import { ExportsRepository } from '#repositories/exports.repository.ts';
import { HealthRepository } from '#repositories/health.repository.ts';
import { LogsRepository } from '#repositories/logs.repository.ts';
import { AgentService } from '#services/agent.service.ts';
import { AppsService } from '#services/apps.service.ts';
import { ArtifactsService } from '#services/artifacts.service.ts';
import { AssetsService } from '#services/assets.service.ts';
import { DeploymentsService } from '#services/deployments.service.ts';
import { ExportsService } from '#services/exports.service.ts';
import { FilesystemService } from '#services/filesystem.service.ts';
import { HealthService } from '#services/health.service.ts';
import { HostnamesService } from '#services/hostnames.service.ts';
import { LogsService } from '#services/logs.service.ts';
import { McpService } from '#services/mcp.service.ts';

// Read once, where every other piece of the environment is read: a key of the wrong length is a
// deployment that fails to start rather than one that fails on the first secret written.
const secretsKey = readSecretsKey(env.TENANT_SECRETS_KEY);

const cloudflareClient =
  env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ZONE_ID
    ? new CloudflareClient({
        apiToken: env.CLOUDFLARE_API_TOKEN,
        zoneId: env.CLOUDFLARE_ZONE_ID,
      })
    : undefined;

const victoriaLogsClient = new VictoriaLogsClient(env.VICTORIALOGS_ENDPOINT);

const agentRepository = new AgentRepository({ sql, secretsKey });
const assetsRepository = new AssetsRepository(sql);
const healthRepository = new HealthRepository({
  sql,
  logStore: victoriaLogsClient.health,
  objectStore: artifactsS3,
});
const appsRepository = new AppsRepository(sql);
const appHostnamesRepository = new AppHostnamesRepository(sql);
const artifactsRepository = new ArtifactsRepository(sql);
const deploymentsRepository = new DeploymentsRepository(sql);
const artifactStorageRepository = new ArtifactStorageRepository({
  client: artifactsS3,
  signer: artifactsSigner,
  bucket: env.ARTIFACTS_BUCKET,
});
const binarySourceRepository = new BinarySourceRepository();
const exportsRepository = new ExportsRepository(sql);
const exportStorageRepository = new ExportStorageRepository(exportsS3);
const customHostnamesRepository = new CustomHostnamesRepository(cloudflareClient);
const logsRepository = new LogsRepository(victoriaLogsClient);

const deploymentsService = new DeploymentsService({ deploymentsRepo: deploymentsRepository });
const appsService = new AppsService({
  appsRepo: appsRepository,
  hostnamesRepo: appHostnamesRepository,
  customHostnamesRepo: customHostnamesRepository,
  exportsRepo: exportsRepository,
  artifactStorageRepo: artifactStorageRepository,
  exportStorageRepo: exportStorageRepository,
  appHostDomain: env.APP_HOST_DOMAIN,
  secretsKey,
});
const hostnamesService = new HostnamesService({
  hostnamesRepo: appHostnamesRepository,
  customHostnamesRepo: customHostnamesRepository,
  appHostDomain: env.APP_HOST_DOMAIN,
});
const exportsService = new ExportsService({
  exportsRepo: exportsRepository,
  storageRepo: exportStorageRepository,
  appsRepo: appsRepository,
  retentionDays: env.EXPORT_RETENTION_DAYS,
});

const assetsService = new AssetsService(assetsRepository);
const healthService = new HealthService({
  healthRepo: healthRepository,
  agentRepo: agentRepository,
});
const filesystemService = new FilesystemService({ deploymentsRepo: deploymentsRepository });
const artifactsService = new ArtifactsService({
  artifactsRepo: artifactsRepository,
  storageRepo: artifactStorageRepository,
  sourceRepo: binarySourceRepository,
  appsRepo: appsRepository,
});
const agentService = new AgentService({
  agentRepo: agentRepository,
  deploymentsService,
  appsService,
  exportsService,
  artifactsService,
  hostnamesService,
});
const logsService = new LogsService({
  logsRepo: logsRepository,
  deploymentsRepo: deploymentsRepository,
});

export function loggerPlugin(name: string) {
  const logger = createLogger(name);
  return new Elysia({ name: `logger.${name}` }).derive({ as: 'scoped' }, () => ({ logger }));
}

// Reaches the api through its own public routes rather than through the services beside it, so a
// tool can do exactly what the caller whose token it carries could do, and nothing more. It is
// handed the assembled server in `createApp`.
export const mcpService = new McpService();

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

export const AppsServicePlugin = new Elysia({ name: 'service.apps' }).decorate(
  'appsService',
  appsService,
);

export const ArtifactsServicePlugin = new Elysia({ name: 'service.artifacts' }).decorate(
  'artifactsService',
  artifactsService,
);

export const DeploymentsServicePlugin = new Elysia({ name: 'service.deployments' }).decorate(
  'deploymentsService',
  deploymentsService,
);

export const LogsServicePlugin = new Elysia({ name: 'service.logs' }).decorate(
  'logsService',
  logsService,
);

export const HostnamesServicePlugin = new Elysia({ name: 'service.hostnames' }).decorate(
  'hostnamesService',
  hostnamesService,
);

export const ExportsServicePlugin = new Elysia({ name: 'service.exports' }).decorate(
  'exportsService',
  exportsService,
);

export const McpServicePlugin = new Elysia({ name: 'service.mcp' }).decorate(
  'mcpService',
  mcpService,
);
