import { env } from '#lib/env.ts';

const credentials = {
  endpoint: env.S3_ENDPOINT.origin,
  region: env.S3_REGION,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
};

// A client per bucket rather than a bucket argument at each call, because the two are not
// interchangeable: this end may write artifacts but only read exports, so a call that named the
// wrong bucket would fail at the store rather than at the type.

export const artifactsS3 = new Bun.S3Client({ bucket: env.ARTIFACTS_BUCKET, ...credentials });

export const exportsS3 = new Bun.S3Client({ bucket: env.EXPORTS_BUCKET, ...credentials });
