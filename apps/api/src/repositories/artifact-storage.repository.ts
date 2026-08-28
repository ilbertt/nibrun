import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

export abstract class ArtifactStorageRepositoryContract {
  abstract signUpload(input: { objectKey: ObjectKey; sizeBytes: number }): Promise<string>;
  abstract write(input: { objectKey: ObjectKey; body: ReadableStream<Uint8Array> }): Promise<void>;
  abstract read(input: { objectKey: ObjectKey }): ReadableStream<Uint8Array>;
  abstract copy(input: { from: ObjectKey; to: ObjectKey }): Promise<void>;
  abstract exists(input: { objectKey: ObjectKey }): Promise<boolean>;
  abstract remove(input: { objectKey: ObjectKey }): Promise<void>;
}

export class ArtifactStorageRepository implements ArtifactStorageRepositoryContract {
  private readonly client: Bun.S3Client;
  private readonly signer: S3Client;
  private readonly bucket: string;

  constructor({
    client,
    signer,
    bucket,
  }: {
    client: Bun.S3Client;
    signer: S3Client;
    bucket: string;
  }) {
    this.client = client;
    this.signer = signer;
    this.bucket = bucket;
  }

  /**
   * Signed rather than proxied: a binary is far larger than anything else this api handles, and
   * taking delivery of one would spend the control plane's memory and bandwidth on every deploy
   * — and put every upload under whatever body limit the edge in front of it enforces.
   *
   * The signature carries this end's permissions, which are this bucket and nothing else, and it
   * covers the length as well as the key: a signature holds whatever headers it names, so naming
   * `content-length` is what makes the store refuse a body of any other size. Bun's `presign` has
   * no way to name one — https://github.com/oven-sh/bun/issues/18240 — which is the whole reason
   * the signing here is not its.
   *
   * Exactly the size that was declared rather than at most it: this end was told what it is being
   * offered, and a body of any other length is not the upload it agreed to.
   */
  async signUpload({
    objectKey,
    sizeBytes,
  }: {
    objectKey: ObjectKey;
    sizeBytes: number;
  }): Promise<string> {
    return await getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentLength: sizeBytes,
      }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS, signableHeaders: new Set(['content-length']) },
    );
  }

  /**
   * The only way bytes reach a key without a signed url: the api fetched them itself, or is moving
   * what it already holds, so it is the api that has to put them somewhere.
   *
   * Streamed rather than buffered: this runs on an object as large as a whole binary, and holding
   * one in memory is the cost that signing the upload away was meant to avoid.
   */
  async write({
    objectKey,
    body,
  }: {
    objectKey: ObjectKey;
    body: ReadableStream<Uint8Array>;
  }): Promise<void> {
    const writer = this.client.file(objectKey).writer({
      type: ARTIFACT_CONTENT_TYPE,
      retry: UPLOAD_RETRIES,
    });
    try {
      for await (const chunk of body) {
        await writer.write(chunk);
      }
      await writer.end();
    } catch (failure) {
      await abandon({ writer, failure });
      throw failure;
    }
  }

  read({ objectKey }: { objectKey: ObjectKey }): ReadableStream<Uint8Array> {
    return this.client.file(objectKey).stream();
  }

  /**
   * Nothing else writes the content-addressed namespace. That is what lets a key found there be
   * trusted without reading it again — the bytes under it were hashed by this process, on their
   * way to it.
   */
  async copy({ from, to }: { from: ObjectKey; to: ObjectKey }): Promise<void> {
    await this.write({ objectKey: to, body: this.read({ objectKey: from }) });
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
