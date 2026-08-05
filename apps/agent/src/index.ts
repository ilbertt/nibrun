import { FetchHttpClient } from '@effect/platform';
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Effect, Layer } from 'effect';
import { run } from '#lib/agent/run.ts';
import { AgentLogger } from '#lib/logger.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { AgentSessionHolder } from '#services/agent-session-holder.service.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { ArtifactStore } from '#services/artifact-store.service.ts';
import { CaddyProxy } from '#services/caddy-proxy.service.ts';
import { CommandRunner } from '#services/command-runner.service.ts';
import { ControlPlane } from '#services/control-plane.service.ts';
import { DesiredStateCache } from '#services/desired-state-cache.service.ts';
import { ExportManager } from '#services/export-manager.service.ts';
import { FilesystemReader } from '#services/filesystem-reader.service.ts';
import { LogStore } from '#services/log-store.service.ts';
import { Reconciler } from '#services/reconciler.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { TenantLogQueue } from '#services/tenant-log-queue.service.ts';
import { TenantLogReceiver } from '#services/tenant-log-receiver.service.ts';
import { VmManager } from '#services/vm-manager.service.ts';
import { VolumeManager } from '#services/volume-manager.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';

const platform = Layer.mergeAll(BunContext.layer, FetchHttpClient.layer);

/**
 * Flat rather than tiered, because each service provides its own requirements. A layer named by
 * two of them is still built once, which is what keeps one slot table, one log queue and one
 * credential cache on a host — so the order here carries nothing.
 */
const agent = Layer.mergeAll(
  AgentConfig.Default,
  AgentState.Default,
  CommandRunner.Default,
  ControlPlane.Default,
  LogStore.Default,
  ArtifactStore.Default,
  SlotAllocator.Default,
  ZerofsTopology.Default,
  CaddyProxy.Default,
  TenantLogQueue.Default,
  TenantLogReceiver.Default,
  VolumeManager.Default,
  ExportManager.Default,
  FilesystemReader.Default,
  VmManager.Default,
  DesiredStateCache.Default,
  AgentSessionHolder.Default,
  Reconciler.Default,
).pipe(Layer.provideMerge(platform));

// The agent stopping must not stop anything it started: the VMs are systemd's children, which is
// what lets this component be redeployed as often as it changes.
BunRuntime.runMain(run.pipe(Effect.provide(agent), Effect.provide(AgentLogger)));
