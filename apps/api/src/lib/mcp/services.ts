import type { AppsService } from '#services/apps.service.ts';
import type { ArtifactsService } from '#services/artifacts.service.ts';
import type { DeploymentsService } from '#services/deployments.service.ts';
import type { ExportsService } from '#services/exports.service.ts';
import type { FilesystemService } from '#services/filesystem.service.ts';
import type { HostnamesService } from '#services/hostnames.service.ts';
import type { LogsService } from '#services/logs.service.ts';

/**
 * What the tools act through, which is the same services every controller calls.
 *
 * A tool is a controller in every way that matters — it takes a request, scopes it to whoever
 * made it, and asks a service. Naming them here rather than reaching for the wired graph is what
 * keeps a tool honest about which of them it touches.
 */
export type McpServices = {
  apps: AppsService;
  artifacts: ArtifactsService;
  deployments: DeploymentsService;
  exports: ExportsService;
  filesystem: FilesystemService;
  hostnames: HostnamesService;
  logs: LogsService;
};
