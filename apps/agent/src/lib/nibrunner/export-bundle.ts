import { FileSystem, Path } from '@effect/platform';
import type { DesiredArtifact } from '@repo/protocol';
import { Data, Effect, Option } from 'effect';
import {
  BUNDLE_NAME,
  bundleBinaryName,
  CRONTAB_FILENAME,
  DATA_DIRECTORY,
  ENV_FILENAME,
} from '#lib/exports/bundle.ts';
import { NIBRUNNER_DATA_DIRECTORY } from '#lib/nibrunner/paths.ts';
import { BINARY_MODE, downloadAndVerify } from '#lib/vm/artifacts.ts';
import { stdoutOf } from '#services/command-runner.service.ts';

const STAGING_MODE = 0o700;
const ARCHIVE_TIMEOUT = '1 hour';

export class InvalidNibrunnerExport extends Data.TaggedError('InvalidNibrunnerExport') {
  override get message() {
    return 'The prepared export does not contain a valid nibrun dataset.';
  }
}

export const writeNibrunnerExportBundle = Effect.fn('writeNibrunnerExportBundle')(function* ({
  preparedDirectory,
  artifact,
  artifactBucket,
  stagingDir,
}: {
  preparedDirectory: string;
  artifact: DesiredArtifact;
  artifactBucket: string;
  stagingDir: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  function requireType({ file, type }: { file: string; type: 'Directory' | 'File' }) {
    return Effect.gen(function* () {
      const link = yield* fs.readLink(file).pipe(Effect.option);
      if (Option.isSome(link) || (yield* fs.stat(file)).type !== type) {
        return yield* new InvalidNibrunnerExport();
      }
    });
  }

  let dataPath = preparedDirectory;
  for (const part of ['', DATA_DIRECTORY, ...NIBRUNNER_DATA_DIRECTORY.split('/').filter(Boolean)]) {
    dataPath = path.join(dataPath, part);
    yield* requireType({ file: dataPath, type: 'Directory' });
  }
  const metadataFiles: string[] = [];
  for (const filename of [ENV_FILENAME, CRONTAB_FILENAME]) {
    const file = path.join(preparedDirectory, filename);
    if (yield* fs.exists(file)) {
      yield* requireType({ file, type: 'File' });
      metadataFiles.push(filename);
    }
  }
  const binaryName = yield* bundleBinaryName({ artifact, metadataFiles });
  yield* fs.makeDirectory(stagingDir, { recursive: true, mode: STAGING_MODE });
  const binaryPath = path.join(stagingDir, binaryName);
  yield* downloadAndVerify({ artifact, destination: binaryPath, bucket: artifactBucket });
  yield* fs.chmod(binaryPath, BINARY_MODE);
  const bundlePath = path.join(stagingDir, BUNDLE_NAME);
  yield* stdoutOf({
    command: [
      'tar',
      'czf',
      bundlePath,
      '-C',
      path.dirname(dataPath),
      path.basename(dataPath),
      '-C',
      stagingDir,
      binaryName,
      '-C',
      preparedDirectory,
      ...metadataFiles,
    ],
    env: { COPYFILE_DISABLE: '1' },
    timeout: ARCHIVE_TIMEOUT,
  });
  return { path: bundlePath, sizeBytes: Number((yield* fs.stat(bundlePath)).size) };
});
