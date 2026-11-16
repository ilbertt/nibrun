import { type OciImage, OciImageSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';

const SHA256_HEX_LENGTH = 64;

export function ociImage(): OciImage {
  return Value.Parse(OciImageSchema, {
    kind: 'oci',
    repository: 'docker.io/library/busybox',
    digest: 'a'.repeat(SHA256_HEX_LENGTH),
    program: '/bin/busybox',
    workingDirectory: '/app',
  });
}
