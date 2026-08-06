import { env } from '#lib/env.ts';

const credentials = {
  endpoint: env.S3_ENDPOINT.origin,
  region: env.S3_REGION,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
};

export const artifactsS3 = new Bun.S3Client({ bucket: env.ARTIFACTS_BUCKET, ...credentials });

export const exportsS3 = new Bun.S3Client({ bucket: env.EXPORTS_BUCKET, ...credentials });
