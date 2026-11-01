import { Effect } from 'effect';
import { makeNibrunnerFilesystem } from '#lib/nibrunner/filesystem.ts';
import { NibrunnerBridgeConfig } from '#services/nibrunner-bridge-config.service.ts';

export class NibrunnerFilesystem extends Effect.Service<NibrunnerFilesystem>()(
  'NibrunnerFilesystem',
  {
    effect: Effect.map(NibrunnerBridgeConfig, (config) =>
      makeNibrunnerFilesystem({ socketPath: config.filesystemSocket }),
    ),
    dependencies: [NibrunnerBridgeConfig.Default],
  },
) {}
