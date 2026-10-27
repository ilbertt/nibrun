import { FileSystem } from '@effect/platform';
import { Effect } from 'effect';
import { copyVolumeImage, type VolumeImageCopyInput } from '#lib/volumes/volume-image-copy.ts';
import { preflightVolumeImageCopy } from '#lib/volumes/volume-migration-preflight.ts';
import { CommandRunner } from '#services/command-runner.service.ts';

export class VolumeImageCopier extends Effect.Service<VolumeImageCopier>()('VolumeImageCopier', {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const commands = yield* CommandRunner;
    return {
      preflight: Effect.fn('VolumeImageCopier.preflight')((input: VolumeImageCopyInput) =>
        preflightVolumeImageCopy(input).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(CommandRunner, commands),
        ),
      ),
      copy: Effect.fn('VolumeImageCopier.copy')((input: VolumeImageCopyInput) =>
        copyVolumeImage(input).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(CommandRunner, commands),
        ),
      ),
    };
  }),
  dependencies: [CommandRunner.Default],
}) {}
