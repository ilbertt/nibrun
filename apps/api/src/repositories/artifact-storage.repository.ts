import type { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import type { ObjectKey } from '@repo/protocol';

const ARTIFACT_CONTENT_TYPE = 'application/octet-stream';

// A transient 5xx from the store would otherwise fail a promotion the caller has already paid to
// upload, so the client retries before the request does.
const UPLOAD_RETRIES = 3;

/**
 * The window an upload has to *begin* in, not to finish in — S3 checks the signature when the
 * request arrives, so a slow link spends this budget once and then has as long as it needs.
 *
 * A presigned URL is a bearer token for the one key it names, and that key is a staging slot
 * inside one app's prefix: a leaked URL can overwrite an upload nobody has registered yet, and
 * reaches nothing that has been.
 */
const UPLOAD_URL_TTL_SECONDS = 900;

/**
 * Everything the caller has to send for the store to accept the upload. `fields` carries the
 * policy and its signature, and goes in the form ahead of the file.
 */
export type SignedUpload = {
  url: string;
  fields: Record<string, string>;
};

export abstract class ArtifactStorageRepositoryContract {
  abstract signUpload(input: { objectKey: ObjectKey; maxSizeBytes: number }): Promise<SignedUpload>;
  abstract read(input: { objectKey: ObjectKey }): ReadableStream<Uint8Array>;
  abstract copy(input: { from: ObjectKey; to: ObjectKey }): Promise<void>;
  abstract exists(input: { objectKey: ObjectKey }): Promise<boolean>;
  abstract remove(input: { objectKey: ObjectKey }): Promise<void>;
}

export class ArtifactStorageRepository implements ArtifactStorageRepositoryContract {
  private readonly client: Bun.S3Client;
  private readonly policySigner: S3Client;
  private readonly bucket: string;

  constructor({
    client,
    policySigner,
    bucket,
  }: {
    client: Bun.S3Client;
    policySigner: S3Client;
    bucket: string;
  }) {
    this.client = client;
    this.policySigner = policySigner;
    this.bucket = bucket;
  }

  /**
   * Signed rather than proxied: a binary is far larger than anything else this api handles, and
   * taking delivery of one would spend the control plane's memory and bandwidth on every deploy
   * — and put every upload under whatever body limit the edge in front of it enforces.
   *
   * The signature carries this end's permissions, which are this bucket and nothing else.
   *
   * A POST policy rather than a presigned PUT, because only a policy can name a size the store
   * itself will hold the upload to. SigV4 binds the headers it lists and no others, and Bun's
   * `presign` offers no way to add one — https://github.com/oven-sh/bun/issues/18240, still open,
   * with an attempt at it closed unmerged. Signing this with Bun would leave the limit to be
   * discovered after the bytes were already stored, which is the upload it exists to refuse.
   */
  async signUpload({
    objectKey,
    maxSizeBytes,
  }: {
    objectKey: ObjectKey;
    maxSizeBytes: number;
  }): Promise<SignedUpload> {
    return await createPresignedPost(this.policySigner, {
      Bucket: this.bucket,
      Key: objectKey,
      Conditions: [['content-length-range', 0, maxSizeBytes]],
      Expires: UPLOAD_URL_TTL_SECONDS,
    });
  }

  read({ objectKey }: { objectKey: ObjectKey }): ReadableStream<Uint8Array> {
    return this.client.file(objectKey).stream();
  }

  /**
   * Streamed rather than buffered: this runs on an object as large as a whole binary, and holding
   * one in memory is the cost that signing the upload away was meant to avoid.
   *
   * Nothing else writes the content-addressed namespace. That is what lets a key found there be
   * trusted without reading it again — the bytes under it were hashed by this process, on their
   * way to it.
   */
  async copy({ from, to }: { from: ObjectKey; to: ObjectKey }): Promise<void> {
    const writer = this.client.file(to).writer({
      type: ARTIFACT_CONTENT_TYPE,
      retry: UPLOAD_RETRIES,
    });
    try {
      for await (const chunk of this.client.file(from).stream()) {
        await writer.write(chunk);
      }
      await writer.end();
    } catch (failure) {
      await abandon({ writer, failure });
      throw failure;
    }
  }

  exists({ objectKey }: { objectKey: ObjectKey }): Promise<boolean> {
    return this.client.file(objectKey).exists();
  }

  /**
   * A key already gone is the state this asks for, so S3 answering that it deleted nothing is
   * this having succeeded — which is what lets a purge interrupted half way be run again.
   */
  async remove({ objectKey }: { objectKey: ObjectKey }): Promise<void> {
    await this.client.delete(objectKey);
  }
}

/**
 * An object this size is uploaded in parts, and one left half way holds every part already sent
 * under a key that names none of them. The bucket's rule is what guarantees they go; this is what
 * makes the ordinary failure immediate rather than a day later.
 *
 * How the abandoning went is not the error worth raising — the copy failing is.
 */
async function abandon({
  writer,
  failure,
}: {
  writer: Bun.NetworkSink;
  failure: unknown;
}): Promise<void> {
  try {
    await writer.end(failure instanceof Error ? failure : new Error(String(failure)));
  } catch {
    return;
  }
}
