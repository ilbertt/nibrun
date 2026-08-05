import { Effect } from 'effect';
import { makeControlPlaneClient } from '#lib/control/client.ts';
import { AgentConfig } from '#services/agent-config.service.ts';

export class ControlPlane extends Effect.Service<ControlPlane>()('ControlPlane', {
  effect: Effect.map(AgentConfig, (config) =>
    makeControlPlaneClient({ baseUrl: config.controlPlaneUrl }),
  ),
  dependencies: [AgentConfig.Default],
}) {}
