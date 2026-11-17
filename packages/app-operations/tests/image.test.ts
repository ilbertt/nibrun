import { expect, test } from 'bun:test';
import { imageFromReference } from '#image.ts';
import { registryImage } from '#tests/support/image.ts';

const DIGEST = registryImage().digest;

function input() {
  return {
    reference: `docker.io/library/busybox@sha256:${DIGEST}`,
    program: '/bin/busybox',
    workingDirectory: '/app',
  };
}

test('a pinned image reference keeps its explicit startup paths', () => {
  expect(imageFromReference(input())).toEqual({
    kind: 'oci',
    repository: 'docker.io/library/busybox',
    digest: DIGEST,
    program: '/bin/busybox',
    workingDirectory: '/app',
  });
});

test.each([
  'busybox',
  'docker.io/library/busybox:latest',
  'docker.io/library/busybox@sha256:abc',
  'https://docker.io/library/busybox',
  'docker.io/library/busybox@sha256:abc extra',
])('an unpinned or malformed image reference is refused: %s', (reference) => {
  expect(() => imageFromReference({ ...input(), reference })).toThrow(
    'registry/repository@sha256:digest',
  );
});

test.each([{ program: 'busybox' }, { workingDirectory: 'app' }, { program: '/bin/busybox\u0000' }])(
  'invalid image startup paths are refused: %j',
  (paths) => {
    expect(() => imageFromReference({ ...input(), ...paths })).toThrow('absolute paths');
  },
);
