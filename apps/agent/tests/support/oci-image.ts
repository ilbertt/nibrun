import { type OciImage, OciImageSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { ARTIFACT_DIGEST } from '#tests/support/artifacts.ts';

export function ociImage(): OciImage {
  return Value.Parse(OciImageSchema, {
    kind: 'oci',
    repository: 'docker.io/library/busybox',
    digest: ARTIFACT_DIGEST,
    program: '/bin/busybox',
    workingDirectory: '/app',
  });
}
