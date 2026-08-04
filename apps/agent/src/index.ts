import { FetchHttpClient } from '@effect/platform';
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Effect, Layer } from 'effect';
import { DesiredStateCache } from '#agent/desired-state.ts';
import { run } from '#agent/run.ts';
import { AgentSessionHolder } from '#agent/session.ts';
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

/**
 * Flat rather than tiered, because each service provides its own requirements. A layer named by
 * two of them is still built once, which is what keeps one slot table, one log queue and one
 * credential cache on a host — so the order here carries nothing.
 */
const agent = Layer.mergeAll(
  AgentConfig.Default,
  AgentState.layer,
  Exec.layer,
  ControlPlane.layer,
  Artifacts.layer,
  SlotAllocator.Default,
  ZerofsTopology.Default,
  CaddyProxy.Default,
  TenantLogQueue.Default,
  TenantLogReceiver.Default,
  VolumeManager.Default,
  ExportManager.Default,
  VmManager.Default,
  DesiredStateCache.Default,
  AgentSessionHolder.Default,
  Reconciler.Default,
).pipe(Layer.provideMerge(platform));

// The agent stopping must not stop anything it started: the VMs are systemd's children, which is
// what lets this component be redeployed as often as it changes.
BunRuntime.runMain(run.pipe(Effect.provide(agent), Effect.provide(AgentLogger)));
