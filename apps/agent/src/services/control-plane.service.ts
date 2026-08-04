import { Context, Effect, Layer } from 'effect';
import { type ControlPlaneClient, makeControlPlaneClient } from '#lib/control/client.ts';
import { AgentConfig } from '#services/agent-config.service.ts';

export class ControlPlane extends Context.Tag('ControlPlane')<ControlPlane, ControlPlaneClient>() {}

export const layer = Layer.effect(
  ControlPlane,
  Effect.map(AgentConfig, (config) => makeControlPlaneClient({ baseUrl: config.controlPlaneUrl })),
).pipe(Layer.provide(AgentConfig.Default));
