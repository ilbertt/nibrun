import { Effect } from 'effect';
import { makeLogStoreClient } from '#lib/logs/store-client.ts';
import { AgentConfig } from '#services/agent-config.service.ts';

export class LogStore extends Effect.Service<LogStore>()('LogStore', {
  effect: Effect.map(AgentConfig, (config) => makeLogStoreClient({ baseUrl: config.logIngestUrl })),
  dependencies: [AgentConfig.Default],
}) {}
