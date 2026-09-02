import { Elysia, StatusMap } from 'elysia';
import { sql } from '#db/client.ts';
import { DesiredStateNews } from '#lib/agent/desired-state-news.ts';
import { CloudflareClient } from '#lib/cloudflare/client.ts';
import { env } from '#lib/env.ts';
import { createLogger } from '#lib/logger.ts';
import { RoutePrefix } from '#lib/routes/prefixes.ts';
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
import { CachedBinariesRepository } from '#repositories/cached-binaries.repository.ts';
import { CustomHostnamesRepository } from '#repositories/custom-hostnames.repository.ts';
import { DeploymentsRepository } from '#repositories/deployments.repository.ts';
import { ExportStorageRepository } from '#repositories/export-storage.repository.ts';
import { ExportsRepository } from '#repositories/exports.repository.ts';
import { HealthRepository } from '#repositories/health.repository.ts';
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
  signer: artifactsSigner,
  bucket: env.ARTIFACTS_BUCKET,
});
const binarySourceRepository = new BinarySourceRepository();
const cachedBinariesRepository = new CachedBinariesRepository(sql);
const releaseDigestRepository = new ReleaseDigestRepository();
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
  cachedRepo: cachedBinariesRepository,
  releaseRepo: releaseDigestRepository,
  appsRepo: appsRepository,
});
/**
 * One for the process, because the hosts waiting on it and the requests moving it are both here.
 */
const desiredStateNews = new DesiredStateNews();

const agentService = new AgentService({
  agentRepo: agentRepository,
  news: desiredStateNews,
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

/** A request that only reads cannot have changed what a host should be running. */
const MUTATING_METHODS: ReadonlySet<string> = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Every owner-driven change, counted in one place rather than at each write that makes one.
 *
 * At the edge because the alternative is a call beside every statement that touches a table
 * desired state is read from, and the failure of that alternative is silent: a write that forgot
 * to say so leaves a host holding a poll for the full hold with the news already in the database.
 * Here there is nothing to forget — an owner changed something or they did not.
 *
 * It over-counts, and that is the direction to be wrong in. A request that changed nothing a host
 * cares about still answers its poll, and the agent's own comparison finds the state it already
 * holds and converges on nothing. What it costs is one round trip; what the other way costs is
 * the latency this exists to remove.
 *
 * Public routes only. A host's own report is not an owner asking for something, and counting one
 * would have every report wake the poll that the same host is holding open.
 */
export const desiredStateNewsPlugin = new Elysia({ name: 'desired-state-news' })
  .onAfterResponse(({ request, set }) => {
    const status =
      typeof set.status === 'string' ? StatusMap[set.status] : (set.status ?? StatusMap.OK);
    if (
      status < StatusMap['Bad Request'] &&
      MUTATING_METHODS.has(request.method) &&
      new URL(request.url).pathname.startsWith(RoutePrefix.Api)
    ) {
      desiredStateNews.changed();
    }
  })
  .as('global');

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
