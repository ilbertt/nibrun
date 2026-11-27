import {
  DesiredExecutableArtifactSchema,
  type DesiredRuntimeArtifact,
  OciImageSchema,
} from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { Queries } from '#db/queries.gen.ts';

type ArtifactColumns = Pick<
  Queries['SelectDesiredDeployments'],
  | 'digest'
  | 'size_bytes'
  | 'object_key'
  | 'original_file_name'
  | 'image_repository'
  | 'image_program'
  | 'image_working_directory'
>;

export function runtimeArtifactOf(row: ArtifactColumns): DesiredRuntimeArtifact {
  return row.image_repository === null
    ? Value.Parse(DesiredExecutableArtifactSchema, {
        kind: 'executable',
        digest: row.digest,
        sizeBytes: Number(row.size_bytes),
        objectKey: row.object_key,
        filename: row.original_file_name,
      })
    : Value.Parse(OciImageSchema, {
        kind: 'oci',
        digest: row.digest,
        repository: row.image_repository,
        program: row.image_program,
        workingDirectory: row.image_working_directory,
      });
}
