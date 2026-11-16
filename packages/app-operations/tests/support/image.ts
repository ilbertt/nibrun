import type { RegistryImage } from '#image.ts';

export function registryImage(): RegistryImage {
  return {
    kind: 'oci',
    repository: 'docker.io/library/busybox',
    digest: 'd9403d88cdf0684fbb9d8e97cf3508e9fb4506cf309a34e42653a1c2bc04a298',
    program: '/bin/busybox',
    workingDirectory: '/app',
  };
}
