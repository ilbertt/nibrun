import { AppIdSchema, DeploymentIdSchema, type HostId } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { SQL } from 'bun';
import { ArtifactIdSchema, OwnerIdSchema } from '#lib/api/identifiers.ts';

const SHA256_HEX_LENGTH = 64;

export async function createDeployedApp({
  sql,
  name,
  hostId,
}: {
  sql: SQL;
  name: string;
  hostId: HostId;
}) {
  const ownerId = Value.Parse(OwnerIdSchema, `${name}-owner`);
  await sql.unsafe(
    `INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $1, $2, true, now(), now())`,
    [ownerId, `${name}@example.test`],
  );
  const [app] = await sql.unsafe(
    'INSERT INTO nibrun.apps (owner_id, name, slug) VALUES ($1, $2, $2) RETURNING id',
    [ownerId, name],
  );
  const appId = Value.Parse(AppIdSchema, app.id);
  const [artifact] = await sql.unsafe(
    `INSERT INTO nibrun.artifacts (app_id, digest, size_bytes, object_key, original_file_name)
     VALUES ($1, $2, 1, $3, 'app') RETURNING id`,
    [appId, 'a'.repeat(SHA256_HEX_LENGTH), `artifacts/${name}`],
  );
  const [config] = await sql.unsafe(
    `INSERT INTO nibrun.app_configs (
       app_id, http_port, args, vcpu_count, memory_mib,
       health_check_interval_ms, health_check_timeout_ms, health_check_grace_period_ms,
       health_check_healthy_threshold, health_check_unhealthy_threshold,
       restart_max_restarts, restart_initial_backoff_ms, restart_max_backoff_ms,
       restart_backoff_factor, restart_reset_after_ms)
     VALUES ($1, 3000, '{}', 1, 256, 1000, 1000, 30000, 1, 3, 5, 500, 5000, 2, 60000)
     RETURNING id`,
    [appId],
  );
  const [deployment] = await sql.unsafe(
    `INSERT INTO nibrun.deployments (app_id, artifact_id, config_id, state, host_id)
     VALUES ($1, $2, $3, 'running', $4) RETURNING id`,
    [appId, artifact.id, config.id, hostId],
  );
  return {
    appId,
    ownerId,
    artifactId: Value.Parse(ArtifactIdSchema, artifact.id),
    deploymentId: Value.Parse(DeploymentIdSchema, deployment.id),
  };
}
