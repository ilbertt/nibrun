import type { PublicApiClient } from '@repo/api-client/public';
import type { TenantLogRecord } from '@repo/protocol';

export const SLUG = 'quiet-otter';
export const HOSTNAME = `${SLUG}.nibrun.app`;
export const APP_ID = 'app-1';
export const DEPLOYMENT_ID = 'deployment-1';
export const UPDATED_AT = '2026-08-30T10:00:00Z';

export function anApp({ state }: { state: 'active' | 'suspended' }) {
  return {
    id: APP_ID,
    slug: SLUG,
    state,
    updatedAt: UPDATED_AT,
    hostnames: [{ hostname: HOSTNAME, kind: 'platform', state: 'active' }],
    config: { args: [], httpPort: 3000, hasExtraPublicPort: false, environment: {} },
  };
}

export function aRunningRelease() {
  return { id: DEPLOYMENT_ID, state: 'running', createdAt: UPDATED_AT, artifactId: 'artifact-1' };
}

/** Records as a host wrote them: oldest first, each at its own instant, which is what admits them all. */
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
 * The api as the tools reach it. Hand-rolled rather than generated, the same way
 * `@repo/app-operations` fakes one: what a test is pinning is the request a tool made, and a
 * client that answers only those is the shortest way to say which those are.
 */
export function apiHolding({
  apps,
  deployments = [],
  output = [],
}: {
  apps: unknown[];
  deployments?: unknown[];
  output?: TenantLogRecord[];
}): PublicApiClient {
  const addressed = Object.assign(
    () => ({
      deployments: Object.assign(() => ({ logs: { get: () => streamed(output) } }), {
        get: () => Promise.resolve({ data: { deployments }, error: null }),
      }),
    }),
    { get: () => Promise.resolve({ data: { apps }, error: null }) },
  );
  return { api: { apps: addressed } } as unknown as PublicApiClient;
}

function* records(output: TenantLogRecord[]) {
  for (const data of output) {
    yield { data };
  }
}

function streamed(output: TenantLogRecord[]) {
  return Promise.resolve({ data: records(output), error: null });
}
