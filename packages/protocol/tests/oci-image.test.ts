import { expect, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { OciImageSchema } from '#schemas/oci-image.ts';

const SHA256_HEX_LENGTH = 64;

function image() {
  return {
    kind: 'oci',
    repository: 'docker.io/library/busybox',
    digest: 'a'.repeat(SHA256_HEX_LENGTH),
    program: '/bin/busybox',
    workingDirectory: '/app',
  };
}

test('an OCI image pins its repository, digest and explicit startup paths', () => {
  expect(Value.Check(OciImageSchema, image())).toBe(true);
});

test.each([
  { repository: 'https://docker.io/library/busybox' },
  { repository: 'docker.io/library/busybox:latest' },
  { repository: 'docker.io/library/busybox@sha256:abc' },
  { repository: 'user:password@docker.io/library/busybox' },
  { repository: 'docker.io/../busybox' },
  { digest: 'sha256:abc' },
  { program: 'busybox' },
  { program: '/bin/busybox\u0000' },
  { workingDirectory: 'app' },
])('invalid image references and startup paths are refused: %j', (invalid) => {
  expect(Value.Check(OciImageSchema, { ...image(), ...invalid })).toBe(false);
});

test.each(['ghcr.io/owner/my--image', 'docker.io/team/my__image', 'quay.io/team/a'])(
  'standard repository separators are accepted: %s',
  (repository) => {
    expect(Value.Check(OciImageSchema, { ...image(), repository })).toBe(true);
  },
);
