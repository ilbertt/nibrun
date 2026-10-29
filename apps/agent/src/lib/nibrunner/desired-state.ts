import type { DesiredVolume, HostDesiredState } from '@repo/protocol';
import { emptyDataArchive, localArtifactReference } from '#lib/nibrunner/artifact.ts';
import type { HostDesiredState as NibrunnerDesiredState } from '#lib/nibrunner/desired.gen.ts';
import { UnsupportedNibrunnerFeature } from '#lib/nibrunner/failure.ts';
import { nibrunnerInstance } from '#lib/nibrunner/instance.ts';
import { NIBRUNNER_DATA_DIRECTORY } from '#lib/nibrunner/paths.ts';

function nibrunnerVolume(volume: DesiredVolume): NibrunnerDesiredState['volumes'][number] {
  if (volume.storage !== undefined) {
    throw new UnsupportedNibrunnerFeature({ feature: 'per-volume storage' });
  }
  return {
    volumeId: volume.volumeId,
    appId: volume.appId,
    sizeBytes: volume.sizeBytes,
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
  if (desired.exports.length > 0) {
    throw new UnsupportedNibrunnerFeature({ feature: 'exports' });
  }
  return {
    hostId: desired.hostId,
    revision,
    volumes: desired.volumes.map(nibrunnerVolume),
    instances: desired.instances.map(nibrunnerInstance),
    checkpoints: desired.checkpoints,
    exports: [],
  };
}
