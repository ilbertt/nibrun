import { type DeployableArtifact, imageFromReference } from '@repo/app-operations';
import { refusedChecksum, refusedUrl } from '@repo/deploy-link';
import { type FileSource, fetchedFile, pickedFile, sourceName } from '#lib/file-source.ts';

export type ImageSource = {
  kind: 'image';
  reference: string;
  program: string;
  workingDirectory: string;
};

export type AppSource = FileSource | ImageSource;

export function isImageSource(source: AppSource | undefined): source is ImageSource {
  return source !== undefined && 'kind' in source;
}

export function emptyImageSource(): ImageSource {
  return { kind: 'image', reference: '', program: '', workingDirectory: '/app' };
}

export function appSourceName(source: AppSource | undefined): string | undefined {
  return isImageSource(source)
    ? source.reference.split('@')[0]?.split('/').at(-1) || undefined
    : sourceName(source);
}

export function appSourceRefusal(source: AppSource | undefined): string | undefined {
  if (source === undefined) {
    return 'Choose an app source to deploy.';
  }
  if (isImageSource(source)) {
    try {
      imageFromReference(source);
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : 'Enter valid image startup settings.';
    }
  }
  const fetched = fetchedFile(source);
  return fetched === undefined
    ? undefined
    : (refusedUrl(fetched.url) ?? refusedChecksum(fetched.sha256));
}

export function deployableAppSource(source: AppSource): DeployableArtifact | undefined {
  if (appSourceRefusal(source) !== undefined) {
    return undefined;
  }
  if (isImageSource(source)) {
    return imageFromReference(source);
  }
  const fetched = fetchedFile(source);
  if (fetched !== undefined) {
    return { url: fetched.url, sha256: fetched.sha256 };
  }
  const file = pickedFile(source);
  return file === undefined ? undefined : { name: file.name, body: file };
}
