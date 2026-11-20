import { FetchHttpClient } from '@effect/platform';
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Effect, Layer } from 'effect';
import { AgentLogger } from '#lib/logger.ts';
import { NibrunnerBridge } from '#services/nibrunner-bridge.service.ts';

const platform = Layer.mergeAll(BunContext.layer, FetchHttpClient.layer);
const program = Effect.flatMap(NibrunnerBridge, (bridge) => bridge.run).pipe(
  Effect.scoped,
  Effect.provide(NibrunnerBridge.Default),
  Effect.provide(platform),
  Effect.provide(AgentLogger),
);

BunRuntime.runMain(program);
