import type { ImageSource } from '#lib/app-source.ts';

export const IMAGE_DIGEST = 'd9403d88cdf0684fbb9d8e97cf3508e9fb4506cf309a34e42653a1c2bc04a298';

export function imageSource(): ImageSource {
  return {
    kind: 'image',
    reference: `docker.io/library/busybox@sha256:${IMAGE_DIGEST}`,
    program: '/bin/busybox',
    workingDirectory: '/app',
  };
}
