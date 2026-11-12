import { type DesiredInstance, SecretStringSchema, type TenantEnvironment } from '@repo/protocol';
import {
  interpolableRuntimeValue,
  RUNTIME_VALUE_NAMES,
  RUNTIME_VALUES,
} from '@repo/protocol/runtime-values';
import { Value } from '@sinclair/typebox/value';
import { withoutPublicPortReferences } from '#lib/guest-environment.ts';
import { localArtifactReference } from '#lib/nibrunner/artifact.ts';
import type { DesiredInstance as NibrunnerInstance } from '#lib/nibrunner/desired.gen.ts';
import {
  NIBRUNNER_APP_DIRECTORY,
  NIBRUNNER_DATA_DIRECTORY,
  NIBRUNNER_EXECUTABLE_PATH,
} from '#lib/nibrunner/paths.ts';

function environmentFor(
  instance: DesiredInstance,
): NibrunnerInstance['config']['command']['environment'] {
  const environment: TenantEnvironment = Object.fromEntries(
    Object.entries(withoutPublicPortReferences(instance.config.environment)).flatMap(
      function translateEntry([name, value]) {
        if (
          RUNTIME_VALUE_NAMES.some(function isOwned(owned) {
            return owned === name;
          })
        ) {
          return [];
        }
        return [
          [
            name,
            Value.Parse(
              SecretStringSchema,
              value.replaceAll(
                interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name),
                NIBRUNNER_DATA_DIRECTORY,
              ),
            ),
          ],
        ];
      },
    ),
  );
  return {
    ...environment,
    [RUNTIME_VALUES.DATA_DIR.name]: Value.Parse(SecretStringSchema, NIBRUNNER_DATA_DIRECTORY),
  };
}

export function nibrunnerInstance(instance: DesiredInstance): NibrunnerInstance {
  const { path, ...probe } = instance.config.healthCheck;
  return {
    appId: instance.appId,
    deploymentId: instance.deploymentId,
    volumeId: instance.volumeId,
    desiredState: instance.desiredState,
    ...(instance.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: instance.idleTimeoutMs }),
    layers: [
      {
        kind: 'executable',
        destinationPath: NIBRUNNER_EXECUTABLE_PATH,
        ...localArtifactReference(instance.artifact),
      },
    ],
    config: {
      httpPort: instance.config.httpPort,
      command: {
        program: NIBRUNNER_EXECUTABLE_PATH,
        args: instance.config.args,
        workingDirectory: NIBRUNNER_APP_DIRECTORY,
        environment: environmentFor(instance),
      },
      resources: instance.config.resources,
      healthCheck:
        path === undefined ? { kind: 'tcp', ...probe } : { kind: 'http', path, ...probe },
      restartPolicy: instance.config.restartPolicy,
    },
    hostnames: instance.hostnames,
    access: { kind: 'public' },
  };
}
