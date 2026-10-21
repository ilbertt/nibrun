import type { DesiredVolume } from '@repo/protocol';
import { Effect } from 'effect';
import { activateAppVolume } from '#lib/volumes/activate-app-volume.ts';
import { retireAppVolume } from '#lib/volumes/retire-app-volume.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { AppVolumeFiles } from '#services/app-volume-files.service.ts';
import { AppVolumeNbd } from '#services/app-volume-nbd.service.ts';
import { CommandRunner } from '#services/command-runner.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { ZerofsTopology } from '#services/zerofs-topology.service.ts';

export class AppZerofs extends Effect.Service<AppZerofs>()('AppZerofs', {
  effect: Effect.gen(function* () {
    const context =
      yield* Effect.context<
        Effect.Effect.Context<
          ReturnType<typeof activateAppVolume> | ReturnType<typeof retireAppVolume>
        >
      >();
    const lifecycle = yield* Effect.makeSemaphore(1);
    return {
      ensure: (desired: DesiredVolume) =>
        lifecycle.withPermits(1)(activateAppVolume(desired).pipe(Effect.provide(context))),
      retire: (desired: DesiredVolume) =>
        lifecycle.withPermits(1)(retireAppVolume(desired).pipe(Effect.provide(context))),
    };
  }),
  dependencies: [
    AgentConfig.Default,
    AppVolumeFiles.Default,
    AppVolumeNbd.Default,
    CommandRunner.Default,
    SlotAllocator.Default,
    ZerofsTopology.Default,
  ],
}) {}
