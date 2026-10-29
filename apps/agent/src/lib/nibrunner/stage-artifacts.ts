import { FileSystem, Path } from '@effect/platform';
import type { DesiredArtifact, HostDesiredState } from '@repo/protocol';
import { Effect } from 'effect';
import { emptyDataArchive } from '#lib/nibrunner/artifact.ts';
import { downloadAndVerify } from '#lib/vm/artifacts.ts';

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;

const stageObject = Effect.fn('nibrunner.stageObject')(function* ({
  artifact,
  directory,
  bucket,
}: {
  artifact: DesiredArtifact;
  directory: string;
  bucket: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const destination = path.join(directory, artifact.digest);
  if (yield* fs.exists(destination)) {
    const stat = yield* fs.stat(destination);
    if (stat.type === 'File' && stat.size === BigInt(artifact.sizeBytes)) {
      return;
    }
  }
  yield* Effect.scoped(
    Effect.gen(function* () {
      const temporary = yield* fs.makeTempFileScoped({ directory });
      yield* fs.chmod(temporary, PRIVATE_FILE_MODE);
      yield* downloadAndVerify({ artifact, destination: temporary, bucket });
      yield* fs.rename(temporary, destination);
    }),
  );
});

const stageEmptyArchive = Effect.fn('nibrunner.stageEmptyArchive')(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const archive = emptyDataArchive();
  const destination = path.join(directory, archive.digest);
  if (yield* fs.exists(destination)) {
    return;
  }
  yield* Effect.scoped(
    Effect.gen(function* () {
      const temporary = yield* fs.makeTempFileScoped({ directory });
      yield* fs.chmod(temporary, PRIVATE_FILE_MODE);
      yield* fs.writeFile(temporary, archive.bytes);
      yield* fs.rename(temporary, destination);
    }),
  );
});

export const stageNibrunnerArtifacts = Effect.fn('nibrunner.stageArtifacts')(function* ({
  desired,
  directory,
  artifactBucket,
  importBucket,
}: {
  desired: HostDesiredState;
  directory: string;
  artifactBucket: string;
  importBucket: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  for (const volume of desired.volumes) {
    if (volume.desiredState === 'absent') {
      continue;
    }
    if (volume.seed) {
      yield* stageObject({ artifact: volume.seed, directory, bucket: importBucket });
    } else {
      yield* stageEmptyArchive(directory);
    }
  }
  for (const instance of desired.instances) {
    if (instance.desiredState !== 'stopped') {
      yield* stageObject({ artifact: instance.artifact, directory, bucket: artifactBucket });
    }
  }
});
