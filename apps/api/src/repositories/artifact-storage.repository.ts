import type { ObjectKey } from '@repo/protocol';

const ARTIFACT_CONTENT_TYPE = 'application/octet-stream';

// A transient 5xx from the store would otherwise fail an upload the caller has already paid to
// send, so the client retries before the request does.
const UPLOAD_RETRIES = 3;

export abstract class ArtifactStorageRepositoryContract {
  abstract put(input: { objectKey: ObjectKey; bytes: Uint8Array }): Promise<void>;
  abstract exists(input: { objectKey: ObjectKey }): Promise<boolean>;
}

export class ArtifactStorageRepository implements ArtifactStorageRepositoryContract {
  private readonly client: Bun.S3Client;

  constructor(client: Bun.S3Client) {
    this.client = client;
  }

  async put({ objectKey, bytes }: { objectKey: ObjectKey; bytes: Uint8Array }): Promise<void> {
    await this.client.write(objectKey, bytes, {
      type: ARTIFACT_CONTENT_TYPE,
      retry: UPLOAD_RETRIES,
    });
  }

  exists({ objectKey }: { objectKey: ObjectKey }): Promise<boolean> {
    return this.client.file(objectKey).exists();
  }
}
