import type { HostDesiredState } from '#lib/nibrunner/desired.gen.ts';

export function nibrunnerWithdrawals({
  held,
  wanted,
}: {
  held: HostDesiredState;
  wanted: HostDesiredState;
}): HostDesiredState {
  const withdrawn = {
    ...held,
    instances: held.instances.flatMap(function withdrawInstance(instance) {
      const next = wanted.instances.find((candidate) => candidate.appId === instance.appId);
      if (!next) {
        return [];
      }
      return [
        {
          ...instance,
          desiredState: next.desiredState === 'stopped' ? 'stopped' : instance.desiredState,
        },
      ];
    }),
    volumes: held.volumes.map(function withdrawVolume(volume) {
      const next = wanted.volumes.find((candidate) => candidate.volumeId === volume.volumeId);
      return {
        ...volume,
        desiredState: next?.desiredState === 'absent' ? 'absent' : volume.desiredState,
      };
    }),
  } satisfies HostDesiredState;
  return Bun.deepEquals(held, withdrawn)
    ? held
    : { ...withdrawn, revision: `preparing-${wanted.revision}` };
}
