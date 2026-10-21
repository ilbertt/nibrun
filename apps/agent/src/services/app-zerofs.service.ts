import type { DesiredVolume } from '@repo/protocol';
import { Effect } from 'effect';
import { activateAppVolume } from '#lib/volumes/activate-app-volume.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { CommandRunner } from '#services/command-runner.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';

export class AppZerofs extends Effect.Service<AppZerofs>()('AppZerofs', {
  effect: Effect.map(
    Effect.context<Effect.Effect.Context<ReturnType<typeof activateAppVolume>>>(),
    (context) => ({
      ensure: (desired: DesiredVolume) => activateAppVolume(desired).pipe(Effect.provide(context)),
    }),
  ),
  dependencies: [
    AgentConfig.Default,
    CommandRunner.Default,
    SlotAllocator.Default,
    ZerofsTopology.Default,
  ],
}) {}
