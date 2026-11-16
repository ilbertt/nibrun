import { expect, test } from 'bun:test';
import {
  appSourceName,
  appSourceRefusal,
  deployableAppSource,
  emptyImageSource,
} from '#lib/app-source.ts';
import { IMAGE_DIGEST, imageSource } from '#tests/support/image-source.ts';

test('a complete image source becomes an OCI artifact rather than an uploaded file', () => {
  expect(appSourceRefusal(imageSource())).toBeUndefined();
  expect(deployableAppSource(imageSource())).toEqual({
    kind: 'oci',
    repository: 'docker.io/library/busybox',
    digest: IMAGE_DIGEST,
    program: '/bin/busybox',
    workingDirectory: '/app',
  });
  expect(appSourceName(imageSource())).toBe('busybox');
});

test.each([
  emptyImageSource(),
  { ...imageSource(), reference: 'docker.io/library/busybox:latest' },
  { ...imageSource(), program: 'busybox' },
  { ...imageSource(), workingDirectory: 'app' },
])('incomplete or invalid image settings cannot submit a deployment: %j', (source) => {
  expect(appSourceRefusal(source)).toBeDefined();
  expect(deployableAppSource(source)).toBeUndefined();
});

test('file and URL sources retain their upload and download paths', () => {
  const file = new File(['binary'], 'server');
  expect(deployableAppSource(file)).toEqual({ name: 'server', body: file });
  expect(deployableAppSource({ url: 'https://releases.test/server' })).toEqual({
    url: 'https://releases.test/server',
    sha256: undefined,
  });
  expect(appSourceName(file)).toBe('server');
  expect(appSourceName({ url: 'https://releases.test/server' })).toBe('server');
});
