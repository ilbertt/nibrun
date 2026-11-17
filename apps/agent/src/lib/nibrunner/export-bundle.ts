import { FileSystem, Path } from '@effect/platform';
import type { DesiredExport } from '@repo/protocol';
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
  config,
  artifactBucket,
  stagingDir,
}: {
  preparedDirectory: string;
  artifact: DesiredExport['artifact'];
  config: DesiredExport['config'];
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
  const parts = 'kind' in artifact ? [] : NIBRUNNER_DATA_DIRECTORY.split('/').filter(Boolean);
  for (const part of ['', DATA_DIRECTORY, ...parts]) {
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
  yield* fs.makeDirectory(stagingDir, { recursive: true, mode: STAGING_MODE });
  const runtimeName = yield* writeRuntimeArtifact({
    artifact,
    config,
    artifactBucket,
    stagingDir,
    metadataFiles,
  });
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
      runtimeName,
      ...(metadataFiles.length > 0 ? ['-C', preparedDirectory, ...metadataFiles] : []),
    ],
    env: { COPYFILE_DISABLE: '1' },
    timeout: ARCHIVE_TIMEOUT,
  });
  return { path: bundlePath, sizeBytes: Number((yield* fs.stat(bundlePath)).size) };
});

const writeRuntimeArtifact = Effect.fn('writeRuntimeArtifact')(function* ({
  artifact,
  config,
  artifactBucket,
  stagingDir,
  metadataFiles,
}: {
  artifact: DesiredExport['artifact'];
  config: DesiredExport['config'];
  artifactBucket: string;
  stagingDir: string;
  metadataFiles: readonly string[];
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if ('kind' in artifact) {
    const filename = 'image.json';
    yield* fs.writeFileString(
      path.join(stagingDir, filename),
      `${JSON.stringify({ image: artifact, config }, null, 2)}\n`,
      { mode: 0o600 },
    );
    return filename;
  }
  const filename = yield* bundleBinaryName({ artifact, metadataFiles });
  const destination = path.join(stagingDir, filename);
  yield* downloadAndVerify({ artifact, destination, bucket: artifactBucket });
  yield* fs.chmod(destination, BINARY_MODE);
  return filename;
});
