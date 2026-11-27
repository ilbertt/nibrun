import type { DesiredVolume, HostDesiredState } from '@repo/protocol';
import { emptyDataArchive, localArtifactReference } from '#artifact.ts';
import type { HostDesiredState as NibrunnerDesiredState } from '#desired.gen.ts';
import { nibrunnerExportKey } from '#exports.ts';
import { nibrunnerInstance } from '#instance.ts';
import { NIBRUNNER_DATA_DIRECTORY } from '#paths.ts';

function nibrunnerVolume(volume: DesiredVolume): NibrunnerDesiredState['volumes'][number] {
  const storage = volume.storage;
  return {
    volumeId: volume.volumeId,
    appId: volume.appId,
    sizeBytes: volume.sizeBytes,
    storage:
      storage === undefined
        ? null
        : {
            ...storage,
            // Legacy nibrun prefixes included a final slash. ZeroFS expects path components.
            prefix: storage.prefix.replace(/\/$/, ''),
            region: storage.region ?? null,
          },
    desiredState: volume.desiredState,
    initialContents: {
      ...localArtifactReference(volume.seed ?? emptyDataArchive()),
      destinationPath: NIBRUNNER_DATA_DIRECTORY,
    },
  };
}

export function nibrunnerDesiredState({
  desired,
  revision,
}: {
  desired: HostDesiredState;
  revision: string;
}): NibrunnerDesiredState {
  const nextExportId = desired.exports
    .filter((item) => item.desiredState === 'present')
    .map((item) => item.exportId)
    .toSorted()[0];
  return {
    hostId: desired.hostId,
    revision,
    volumes: desired.volumes.map(nibrunnerVolume),
    instances: desired.instances.map(nibrunnerInstance),
    checkpoints: desired.checkpoints,
    exports: desired.exports
      .filter((item) => item.desiredState === 'absent' || item.exportId === nextExportId)
      .map(
        ({
          artifact: _artifact,
          config: _config,
          ...item
        }): NibrunnerDesiredState['exports'][number] => ({
          ...item,
          format: 'directory',
          objectKey: nibrunnerExportKey(item.exportId),
        }),
      ),
  };
}
