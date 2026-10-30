import { Path } from '@effect/platform';
import { Config, Effect } from 'effect';

export class NibrunnerBridgeConfig extends Effect.Service<NibrunnerBridgeConfig>()(
  'NibrunnerBridgeConfig',
  {
    effect: Effect.gen(function* () {
      const path = yield* Path.Path;
      const stateDir = yield* Config.string('AGENT_NIBRUNNER_STATE_DIR').pipe(
        Config.withDefault('/var/lib/nibrunner'),
      );
      return {
        controlPlaneUrl: yield* Config.nonEmptyString('AGENT_CONTROL_PLANE_URL'),
        artifactBucket: yield* Config.nonEmptyString('AGENT_ARTIFACT_BUCKET'),
        importBucket: yield* Config.nonEmptyString('AGENT_IMPORT_BUCKET'),
        awsRegion: yield* Config.nonEmptyString('AGENT_AWS_REGION'),
        hostIdFile: path.join(stateDir, 'bridge', 'host-id'),
        desiredStateFile: path.join(stateDir, 'desired.json'),
        reportedStateFile: path.join(stateDir, 'reported.json'),
        artifactStoreDir: path.join(stateDir, 'artifact-store'),
      };
    }),
  },
) {}
