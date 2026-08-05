import { Context, Effect, Layer } from 'effect';
import { type LogStoreClient, makeLogStoreClient } from '#lib/logs/store-client.ts';
import { AgentConfig } from '#services/agent-config.service.ts';

export class LogStore extends Context.Tag('LogStore')<LogStore, LogStoreClient>() {}

export const layer = Layer.effect(
  LogStore,
  Effect.map(AgentConfig, (config) => makeLogStoreClient({ baseUrl: config.logIngestUrl })),
).pipe(Layer.provide(AgentConfig.Default));
