import { Elysia } from 'elysia';
import { sql } from '#db/client.ts';
import { CloudflareClient } from '#lib/cloudflare/client.ts';
import { env } from '#lib/env.ts';
import { createLogger } from '#lib/logger.ts';
import { artifactsS3, exportsS3, importsS3, uploadSigner } from '#lib/s3/client.ts';
import { readSecretsKey } from '#lib/tenant-secrets.ts';
import { VictoriaLogsClient } from '#lib/victorialogs/client.ts';
import { AgentRepository } from '#repositories/agent.repository.ts';
import { AppHostnamesRepository } from '#repositories/app-hostnames.repository.ts';
import { AppsRepository } from '#repositories/apps.repository.ts';
import { ArtifactStorageRepository } from '#repositories/artifact-storage.repository.ts';
import { ArtifactsRepository } from '#repositories/artifacts.repository.ts';
import { AssetsRepository } from '#repositories/assets.repository.ts';
import { BinarySourceRepository } from '#repositories/binary-source.repository.ts';
import { CachedBinariesRepository } from '#repositories/cached-binaries.repository.ts';
import { CustomHostnamesRepository } from '#repositories/custom-hostnames.repository.ts';
import { DeploymentsRepository } from '#repositories/deployments.repository.ts';
import { ExportStorageRepository } from '#repositories/export-storage.repository.ts';
import { ExportsRepository } from '#repositories/exports.repository.ts';
import { HealthRepository } from '#repositories/health.repository.ts';
import { ImportsRepository } from '#repositories/imports.repository.ts';
import { LogsRepository } from '#repositories/logs.repository.ts';
import { ReleaseDigestRepository } from '#repositories/release-digest.repository.ts';
import { AgentService } from '#services/agent.service.ts';
import { AppsService } from '#services/apps.service.ts';
import { ArtifactsService } from '#services/artifacts.service.ts';
import { AssetsService } from '#services/assets.service.ts';
import { DeploymentsService } from '#services/deployments.service.ts';
import { ExportsService } from '#services/exports.service.ts';
import { FilesystemService } from '#services/filesystem.service.ts';
import { HealthService } from '#services/health.service.ts';
import { HostnamesService } from '#services/hostnames.service.ts';
import { ImportsService } from '#services/imports.service.ts';
import { LogsService } from '#services/logs.service.ts';

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
  signer: uploadSigner,
  bucket: env.ARTIFACTS_BUCKET,
});
// The same repository against a different bucket: it takes one as a constructor parameter and
// knows nothing about artifacts, and what an import needs of a store — sign, read back, remove —
// is exactly what it already does.
const importStorageRepository = new ArtifactStorageRepository({
  client: importsS3,
  signer: uploadSigner,
  bucket: env.IMPORTS_BUCKET,
});
const binarySourceRepository = new BinarySourceRepository();
const cachedBinariesRepository = new CachedBinariesRepository(sql);
const releaseDigestRepository = new ReleaseDigestRepository();
const exportsRepository = new ExportsRepository(sql);
const importsRepository = new ImportsRepository(sql);
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
  importStorageRepo: importStorageRepository,
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
  cachedRepo: cachedBinariesRepository,
  releaseRepo: releaseDigestRepository,
  appsRepo: appsRepository,
});
const importsService = new ImportsService({
  importsRepo: importsRepository,
  storageRepo: importStorageRepository,
  appsRepo: appsRepository,
});
const agentService = new AgentService({
  agentRepo: agentRepository,
  deploymentsService,
  appsService,
  exportsService,
  artifactsService,
  importsService,
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

export const ImportsServicePlugin = new Elysia({ name: 'service.imports' }).decorate(
  'importsService',
  importsService,
);
