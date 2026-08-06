import { env } from '#lib/env.ts';

const credentials = {
  endpoint: env.S3_ENDPOINT.origin,
  region: env.S3_REGION,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
};

export const s3 = new Bun.S3Client({ bucket: env.ARTIFACTS_BUCKET, ...credentials });

/**
 * A client of its own rather than a bucket argument at each call, because the two buckets are not
 * interchangeable: this end holds read on exports and nothing else, so a write that reached here
 * by naming the wrong bucket would fail at the store rather than at the type.
 */
export const exportsS3 = new Bun.S3Client({ bucket: env.EXPORTS_BUCKET, ...credentials });
