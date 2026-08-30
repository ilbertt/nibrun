import type { OwnerId, TenantLogRecord } from '@repo/protocol';
import type { McpServices } from '#lib/mcp/services.ts';

export const OWNER_ID = 'owner-1' as OwnerId;
export const SLUG = 'quiet-otter';
export const HOSTNAME = `${SLUG}.nibrun.app`;
export const APP_ID = 'app-1';
export const DEPLOYMENT_ID = 'deployment-1';
export const UPDATED_AT = '2026-08-30T10:00:00Z';

export function anApp({ state }: { state: 'active' | 'suspended' }) {
  return {
    id: APP_ID,
    ownerId: OWNER_ID,
    slug: SLUG,
    state,
    updatedAt: UPDATED_AT,
    createdAt: UPDATED_AT,
    hostnames: [{ hostname: HOSTNAME, kind: 'platform', state: 'active' }],
    config: { args: [], httpPort: 3000, hasExtraPublicPort: false, environment: {} },
    volumeUsage: null,
    computeUsage: null,
  };
}

export function aRunningRelease() {
  return { id: DEPLOYMENT_ID, state: 'running', createdAt: UPDATED_AT, artifactId: 'artifact-1' };
}

/** Records as a host wrote them: oldest first, each at its own instant. */
export function someOutput({ lines }: { lines: number }): TenantLogRecord[] {
  const output: TenantLogRecord[] = [];
  for (let at = 0; at < lines; at += 1) {
    output.push({
      _time: new Date(Date.parse(UPDATED_AT) + at).toISOString(),
      _msg: `line ${at}`,
      stream: 'stdout',
      sourceId: 'source-1',
      sequence: at,
    } as TenantLogRecord);
  }
  return output;
}

/**
 * The services as the tools reach them, answering only what the tool under test asks.
 *
 * Hand-rolled rather than wired: what a test is pinning is the call a tool made and the owner it
 * scoped to, and a stub that answers only those is the shortest way to say which those are.
 */
export function servicesHolding({
  apps = [],
  deployments = [],
  output = [],
}: {
  apps?: unknown[];
  deployments?: unknown[];
  output?: TenantLogRecord[];
}): McpServices {
  return {
    apps: { list: () => Promise.resolve(apps) },
    deployments: { list: () => Promise.resolve(deployments) },
    logs: { openStream: () => Promise.resolve(records(output)) },
  } as unknown as McpServices;
}

function* records(output: TenantLogRecord[]) {
  for (const record of output) {
    yield record;
  }
}
