import { Elysia } from 'elysia';
import { sql } from '#db/client.ts';
import { createAuth } from '#lib/auth/better-auth.ts';
import { authDatabase } from '#lib/auth/database.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { CloudflareClient } from '#lib/cloudflare/client.ts';
import { CloudflareDnsClient } from '#lib/cloudflare-dns/client.ts';
import { env } from '#lib/env.ts';
import { createLogger } from '#lib/logger.ts';
import { RemoteFetchSlots } from '#lib/remote-fetch.ts';
import { artifactsS3, exportsS3, importsS3, uploadSigner } from '#lib/s3/client.ts';
import { openRemoteSqliteSession } from '#lib/sqlite/remote-session.ts';
import { readSecretsKey } from '#lib/tenant-secrets.ts';
import { VictoriaLogsClient } from '#lib/victorialogs/client.ts';
import { AgentRepository } from '#repositories/agent.repository.ts';
import { AppHostnamesRepository } from '#repositories/app-hostnames.repository.ts';
import { AppsRepository } from '#repositories/apps.repository.ts';
import { ArtifactStorageRepository } from '#repositories/artifact-storage.repository.ts';
import { ArtifactsRepository } from '#repositories/artifacts.repository.ts';
import { AssetsRepository } from '#repositories/assets.repository.ts';
import { CachedBinariesRepository } from '#repositories/cached-binaries.repository.ts';
import { CustomHostnamesRepository } from '#repositories/custom-hostnames.repository.ts';
import { DeploymentsRepository } from '#repositories/deployments.repository.ts';
import { DnsRepository } from '#repositories/dns.repository.ts';
import { ExportStorageRepository } from '#repositories/export-storage.repository.ts';
import { ExportsRepository } from '#repositories/exports.repository.ts';
import { GitHubActionsOidcRepository } from '#repositories/github-actions-oidc.repository.ts';
import { GitHubDeploymentGrantsRepository } from '#repositories/github-deployment-grants.repository.ts';
import { HealthRepository } from '#repositories/health.repository.ts';
import { ImportsRepository } from '#repositories/imports.repository.ts';
import { LogsRepository } from '#repositories/logs.repository.ts';
import { PaidRequestsRepository } from '#repositories/paid-requests.repository.ts';
import { ReleaseDigestRepository } from '#repositories/release-digest.repository.ts';
import { RemoteSourceRepository } from '#repositories/remote-source.repository.ts';
import { SqliteConnectionsRepository } from '#repositories/sqlite-connections.repository.ts';
import { TrustedWorkflowsRepository } from '#repositories/trusted-workflows.repository.ts';
import { VolumeStorageMigrationsRepository } from '#repositories/volume-storage-migrations.repository.ts';
import { AgentService } from '#services/agent.service.ts';
import { AppsService } from '#services/apps.service.ts';
import { ArtifactsService } from '#services/artifacts.service.ts';
import { AssetsService } from '#services/assets.service.ts';
import { AuthenticationService } from '#services/authentication.service.ts';
import { CronsService } from '#services/crons.service.ts';
import { DeploymentsService } from '#services/deployments.service.ts';
import { DomainDnsService } from '#services/domain-dns.service.ts';
import { ExportsService } from '#services/exports.service.ts';
import { FilesystemService } from '#services/filesystem.service.ts';
import { GitHubActionsOidcService } from '#services/github-actions-oidc.service.ts';
import { GitHubDeploymentGrantsService } from '#services/github-deployment-grants.service.ts';
import { GitHubDeploymentTokensService } from '#services/github-deployment-tokens.service.ts';
import { HealthService } from '#services/health.service.ts';
import { HostnamesService } from '#services/hostnames.service.ts';
import { ImportsService } from '#services/imports.service.ts';
import { LogsService } from '#services/logs.service.ts';
import { McpAuthorizationService } from '#services/mcp-authorization.service.ts';
import { PaidRequestsService } from '#services/paid-requests.service.ts';
import { SqliteService } from '#services/sqlite.service.ts';
import { SqliteRelayService } from '#services/sqlite-relay.service.ts';
import { TrustedWorkflowsService } from '#services/trusted-workflows.service.ts';
import { VolumeStorageMigrationsService } from '#services/volume-storage-migrations.service.ts';

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

const cloudflareDnsClient = new CloudflareDnsClient();

const victoriaLogsClient = new VictoriaLogsClient(env.VICTORIALOGS_ENDPOINT);

const remoteFetchSlots = new RemoteFetchSlots();

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
const importStorageRepository = new ArtifactStorageRepository({
  client: importsS3,
  signer: uploadSigner,
  bucket: env.IMPORTS_BUCKET,
});
const remoteSourceRepository = new RemoteSourceRepository();
const cachedBinariesRepository = new CachedBinariesRepository(sql);
const releaseDigestRepository = new ReleaseDigestRepository();
const exportsRepository = new ExportsRepository(sql);
const importsRepository = new ImportsRepository(sql);
const exportStorageRepository = new ExportStorageRepository(exportsS3);
const customHostnamesRepository = new CustomHostnamesRepository(cloudflareClient);
const dnsRepository = new DnsRepository(cloudflareDnsClient);
const logsRepository = new LogsRepository(victoriaLogsClient);
const githubActionsOidcRepository = new GitHubActionsOidcRepository();
const githubDeploymentGrantsRepository = new GitHubDeploymentGrantsRepository(sql);
const trustedWorkflowsRepository = new TrustedWorkflowsRepository(sql);
const paidRequestsRepository = new PaidRequestsRepository(sql);
const volumeStorageMigrationsRepository = new VolumeStorageMigrationsRepository(sql);

const volumeStorageMigrationsService = new VolumeStorageMigrationsService({
  migrationsRepo: volumeStorageMigrationsRepository,
  appsRepo: appsRepository,
});

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

export const auth = createAuth({
  appsService,
  database: authDatabase,
});

const githubActionsOidcService = new GitHubActionsOidcService(githubActionsOidcRepository);
const githubDeploymentGrantsService = new GitHubDeploymentGrantsService({
  identityService: githubActionsOidcService,
  grantsRepo: githubDeploymentGrantsRepository,
});
const githubDeploymentTokensService = new GitHubDeploymentTokensService({
  auth: auth.api,
  grantsService: githubDeploymentGrantsService,
});
const trustedWorkflowsService = new TrustedWorkflowsService({
  workflowsRepo: trustedWorkflowsRepository,
});
const paidRequestsService = new PaidRequestsService({
  requestsRepo: paidRequestsRepository,
});
const hostnamesService = new HostnamesService({
  hostnamesRepo: appHostnamesRepository,
  customHostnamesRepo: customHostnamesRepository,
  appHostDomain: env.APP_HOST_DOMAIN,
});
const domainDnsService = new DomainDnsService({
  hostnamesRepo: appHostnamesRepository,
  dnsRepo: dnsRepository,
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
const cronsService = new CronsService({ deploymentsRepo: deploymentsRepository });
const sqliteRelayService = new SqliteRelayService();
const sqliteService = new SqliteService({
  connectionsRepo: new SqliteConnectionsRepository(sql),
  deploymentsRepo: deploymentsRepository,
  baseUrl: env.BASE_URL,
  openSession: function open(input) {
    return openRemoteSqliteSession({ ...input, relay: sqliteRelayService });
  },
});
const artifactsService = new ArtifactsService({
  artifactsRepo: artifactsRepository,
  storageRepo: artifactStorageRepository,
  sourceRepo: remoteSourceRepository,
  fetchSlots: remoteFetchSlots,
  cachedRepo: cachedBinariesRepository,
  releaseRepo: releaseDigestRepository,
  appsRepo: appsRepository,
});
const importsService = new ImportsService({
  importsRepo: importsRepository,
  storageRepo: importStorageRepository,
  sourceRepo: remoteSourceRepository,
  fetchSlots: remoteFetchSlots,
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
  volumeStorageMigrationsService,
});
const logsService = new LogsService({
  logsRepo: logsRepository,
  deploymentsRepo: deploymentsRepository,
});
const mcpAuthorizationService = new McpAuthorizationService();

const authenticationService = new AuthenticationService({
  auth: auth.api,
  grantsService: githubDeploymentGrantsService,
});
export const AuthPlugin = createAuthPlugin(authenticationService);

export const PaidRequestsServicePlugin = new Elysia({ name: 'service.paidRequests' }).decorate(
  'paidRequestsService',
  paidRequestsService,
);

export const McpAuthorizationServicePlugin = new Elysia({
  name: 'service.mcpAuthorization',
}).decorate('mcpAuthorizationService', mcpAuthorizationService);

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

export const CronsServicePlugin = new Elysia({ name: 'service.crons' }).decorate(
  'cronsService',
  cronsService,
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

export const DomainDnsServicePlugin = new Elysia({ name: 'service.domainDns' }).decorate(
  'domainDnsService',
  domainDnsService,
);

export const ExportsServicePlugin = new Elysia({ name: 'service.exports' }).decorate(
  'exportsService',
  exportsService,
);

export const VolumeStorageMigrationsServicePlugin = new Elysia({
  name: 'service.volumeStorageMigrations',
}).decorate('volumeStorageMigrationsService', volumeStorageMigrationsService);

export const ImportsServicePlugin = new Elysia({ name: 'service.imports' }).decorate(
  'importsService',
  importsService,
);

export const SqliteRelayServicePlugin = new Elysia({ name: 'service.sqliteRelay' }).decorate(
  'sqliteRelayService',
  sqliteRelayService,
);

export const SqliteServicePlugin = new Elysia({ name: 'service.sqlite' })
  .decorate('sqliteService', sqliteService)
  .decorate('sqliteOrigin', env.BASE_URL.origin);

export const GitHubActionsOidcServicePlugin = new Elysia({
  name: 'service.githubActionsOidc',
}).decorate('githubActionsOidcService', githubActionsOidcService);

export const TrustedWorkflowsServicePlugin = new Elysia({
  name: 'service.trustedWorkflows',
}).decorate('trustedWorkflowsService', trustedWorkflowsService);

export const GitHubDeploymentGrantsServicePlugin = new Elysia({
  name: 'service.githubDeploymentGrants',
}).decorate('githubDeploymentGrantsService', githubDeploymentGrantsService);

export const GitHubDeploymentTokensServicePlugin = new Elysia({
  name: 'service.githubDeploymentTokens',
}).decorate('githubDeploymentTokensService', githubDeploymentTokensService);
