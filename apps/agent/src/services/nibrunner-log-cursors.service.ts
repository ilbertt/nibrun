import { Effect } from 'effect';
import { makeNibrunnerLogCursors } from '#lib/nibrunner/log-cursors.ts';
import { NibrunnerBridgeConfig } from '#services/nibrunner-bridge-config.service.ts';

export class NibrunnerLogCursors extends Effect.Service<NibrunnerLogCursors>()(
  'NibrunnerLogCursors',
  {
    effect: Effect.flatMap(NibrunnerBridgeConfig, (config) =>
      makeNibrunnerLogCursors({ file: config.logCursorsFile }),
    ),
    dependencies: [NibrunnerBridgeConfig.Default],
  },
) {}
