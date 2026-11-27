import type { ImageArtifact } from '@repo/api-client/models';

export type RegistryImage = Omit<ImageArtifact, 'id' | 'appId' | 'createdAt'>;

export function imageFromReference({
  reference,
  program,
  workingDirectory,
}: {
  reference: string;
  program: string;
  workingDirectory: string;
}): RegistryImage {
  const matched = /^([a-z0-9][a-z0-9./_-]+)@sha256:([a-fA-F0-9]{64})$/.exec(reference.trim());
  if (matched === null || !matched[1]?.includes('/')) {
    throw new Error('Use a full registry/repository@sha256:digest image reference.');
  }
  if (!isAbsolutePath(program) || !isAbsolutePath(workingDirectory)) {
    throw new Error('The image program and working directory must be absolute paths.');
  }
  return {
    kind: 'oci',
    repository: matched[1],
    digest: matched[2]!.toLowerCase(),
    program,
    workingDirectory,
  };
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') && !path.includes('\u0000');
}
