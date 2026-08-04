import { FetchHttpClient } from '@effect/platform';
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Effect, Layer } from 'effect';
import { DesiredStateCache } from '#agent/desired-state.ts';
import { run } from '#agent/run.ts';
import { AgentSessionHolder } from '#agent/session.ts';
import { AwsCredentialProvider } from '#aws/provider.ts';
import { AgentConfig } from '#config.ts';
import * as ControlPlane from '#control/client.ts';
import { ExportManager } from '#exports/manager.ts';
import * as Exec from '#lib/exec.ts';
import { AgentLogger } from '#lib/logger.ts';
import { TenantLogQueue } from '#logs/queue.ts';
import { TenantLogReceiver } from '#logs/receiver.ts';
import { SlotAllocator } from '#network/allocator.ts';
import { CaddyProxy } from '#proxy/caddy.ts';
import { Reconciler } from '#reconcile/reconciler.ts';
import * as AgentState from '#reconcile/state.ts';
import * as Artifacts from '#vm/artifacts.ts';
import { VmManager } from '#vm/manager.ts';
import { VolumeManager } from '#volumes/manager.ts';
import { ZerofsTopology } from '#volumes/topology.ts';

const platform = Layer.mergeAll(BunContext.layer, FetchHttpClient.layer);

const base = Layer.mergeAll(AgentConfig.Default, Exec.layer, AgentState.layer).pipe(
  Layer.provideMerge(platform),
);

const stores = Layer.mergeAll(
  SlotAllocator.Default,
  ZerofsTopology.Default,
  AwsCredentialProvider.Default,
  ControlPlane.layer,
  TenantLogQueue.Default,
).pipe(Layer.provideMerge(base));

const managers = Layer.mergeAll(
  Artifacts.layer,
  TenantLogReceiver.Default,
  CaddyProxy.Default,
  VolumeManager.Default,
  ExportManager.Default,
).pipe(Layer.provideMerge(stores));

const agent = Layer.mergeAll(
  Reconciler.Default,
  AgentSessionHolder.Default,
  DesiredStateCache.Default,
).pipe(Layer.provideMerge(VmManager.Default.pipe(Layer.provideMerge(managers))));

// The agent stopping must not stop anything it started: the VMs are systemd's children, which is
// what lets this component be redeployed as often as it changes.
BunRuntime.runMain(run.pipe(Effect.provide(agent), Effect.provide(AgentLogger)));
