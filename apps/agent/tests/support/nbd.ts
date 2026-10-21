import { attachmentScope } from '#lib/volumes/nbd.ts';

export function privateNbdProcess(target: Parameters<typeof attachmentScope>[0]) {
  return {
    cmdline: [
      '/usr/sbin/nbd-client',
      '-unix',
      target.socketPath,
      target.devicePath,
      '-N',
      target.volumeId,
      '-persist',
      '-nonetlink',
      '-timeout',
      '600',
      '-connections',
      '4',
      '-block-size',
      '4096',
      '',
    ].join('\0'),
    cgroup: `0::/system.slice/${attachmentScope(target)}\n`,
  };
}
