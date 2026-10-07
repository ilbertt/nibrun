import type { Treaty } from '@elysiajs/eden';
import type { PublicApiClient } from '#public.ts';

type AppRoutes = ReturnType<PublicApiClient['api']['apps']>;
type DeploymentRoutes = ReturnType<AppRoutes['deployments']>;

export type App = Treaty.Data<AppRoutes['get']>;
export type AppState = App['state'];
export type AppActivation = App['activation'];
export type AppHostname = App['hostnames'][number];
export type AppHostnameState = AppHostname['state'];
export type AppHostnameKind = AppHostname['kind'];
export type AppPatch = NonNullable<Parameters<AppRoutes['patch']>[0]>;
export type OwnedAppState = Parameters<AppRoutes['state']['put']>[0]['state'];
export type TenantArguments = App['config']['args'];
export type TenantEnvironmentPatch = NonNullable<AppPatch['environment']>;
export type Deployment = Treaty.Data<DeploymentRoutes['get']>;
export type DeploymentState = Deployment['state'];
export type InstanceState = NonNullable<Deployment['instanceState']>;
export type Artifact = Treaty.Data<ReturnType<AppRoutes['artifacts']>['get']>;
export type Filename = Artifact['originalFileName'];
export type Sha256Digest = Artifact['digest'];
export type ImportId = Treaty.Data<AppRoutes['imports']['post']>['importId'];
export type Export = Treaty.Data<ReturnType<AppRoutes['exports']>['get']>;
export type ExportState = Export['state'];
export type CronListing = Treaty.Data<DeploymentRoutes['crons']['get']>;
export type DirectoryListing = Treaty.Data<DeploymentRoutes['filesystem']['get']>;
export type FilesystemEntry = DirectoryListing['entries'][number];
export type FilesystemEntryKind = FilesystemEntry['kind'];
export type GuestPath = NonNullable<
  NonNullable<NonNullable<Parameters<DeploymentRoutes['filesystem']['get']>[0]>['query']>['path']
>;
type LogStream = Treaty.Data<DeploymentRoutes['logs']['get']>;
export type TenantLogRecord =
  LogStream extends AsyncGenerator<infer Event>
    ? Event extends { data: infer Record }
      ? Record
      : never
    : never;
export type LogTimerange = NonNullable<
  NonNullable<NonNullable<Parameters<DeploymentRoutes['logs']['get']>[0]>['query']>['timerange']
>;
export type RequiredDomainDnsRecord = Pick<
  Treaty.Data<AppRoutes['hostnames']['dns']['get']>['records'][number],
  'hostname' | 'type' | 'target'
>;

export type RegisteredCronJob = CronListing['jobs'][number];
export type CronJobId = RegisteredCronJob['jobId'];
export type LogSource = TenantLogRecord['SOURCE'];

export type TenantLogStream = TenantLogRecord['stream'];

type SqlitePipelineRoute = ReturnType<
  PublicApiClient['api']['sqlite']['connections']
>['v2']['pipeline']['post'];
export type SqlitePipelineResponse = Treaty.Data<SqlitePipelineRoute>;
type SqliteStreamResponse = Extract<
  SqlitePipelineResponse['results'][number],
  { type: 'ok' }
>['response'];
export type SqliteStatementResult = Extract<SqliteStreamResponse, { type: 'execute' }>['result'];
