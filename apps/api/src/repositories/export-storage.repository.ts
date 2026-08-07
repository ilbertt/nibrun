import type { ObjectKey } from '@repo/protocol';

/**
 * Short enough that a URL copied out of a response stops working long before the bundle does, and
 * long enough to survive starting the download on a slow connection. A presigned URL is a bearer
 * token for a tenant's entire dataset, so this is the window in which one has to be useful, not
 * the window in which the export is valid — that is the bucket's lifecycle rule.
 */
const DOWNLOAD_URL_TTL_SECONDS = 300;

export abstract class ExportStorageRepositoryContract {
  abstract signDownload(input: { objectKey: ObjectKey }): string;
  abstract remove(input: { objectKey: ObjectKey }): Promise<void>;
}

export class ExportStorageRepository implements ExportStorageRepositoryContract {
  private readonly client: Bun.S3Client;

  constructor(client: Bun.S3Client) {
    this.client = client;
  }

  /**
   * Signed rather than proxied: the bytes are a tenant's whole dataset, and streaming them
   * through this process would put every export through the control plane's own bandwidth.
   *
   * The signature carries this end's permissions, which are read on the export bucket and
   * nothing else — so a leaked URL is a leaked bundle rather than a leaked bucket.
   */
  signDownload({ objectKey }: { objectKey: ObjectKey }): string {
    return this.client.presign(objectKey, {
      method: 'GET',
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
    });
  }

  /**
   * The lifecycle rule would reach this bundle eventually, and eventually is the whole retention
   * window: the app it was taken from is gone, so what is left is a tenant's dataset outliving
   * every way of asking for it. Removing it early is what closes that window.
   */
  async remove({ objectKey }: { objectKey: ObjectKey }): Promise<void> {
    await this.client.delete(objectKey);
  }
}
