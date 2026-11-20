import { type DesiredArtifact, FilenameSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Data, Either } from 'effect';

export const DATA_DIRECTORY = 'data';
export const ENV_FILENAME = '.env';
export const CRONTAB_FILENAME = 'crontab';
export const BUNDLE_NAME = 'bundle.tar.gz';

export class UnsafeFilename extends Data.TaggedError('UnsafeFilename')<{
  readonly filename: string;
}> {
  override get message() {
    return 'The binary filename is not safe for an export.';
  }
}

export function bundleBinaryName({
  artifact,
  metadataFiles,
}: {
  artifact: DesiredArtifact;
  metadataFiles: readonly string[];
}): Either.Either<string, UnsafeFilename> {
  const { filename } = artifact;
  return !Value.Check(FilenameSchema, filename)
    ? Either.left(new UnsafeFilename({ filename }))
    : Either.right(
        [DATA_DIRECTORY, BUNDLE_NAME, ...metadataFiles].includes(filename)
          ? `${filename}.binary`
          : filename,
      );
}
