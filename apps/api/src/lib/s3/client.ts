import { S3Client } from '@aws-sdk/client-s3';
import { env } from '#lib/env.ts';

const credentials = {
  endpoint: env.S3_ENDPOINT.origin,
  region: env.S3_REGION,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
};

export const artifactsS3 = new Bun.S3Client({ bucket: env.ARTIFACTS_BUCKET, ...credentials });

export const exportsS3 = new Bun.S3Client({ bucket: env.EXPORTS_BUCKET, ...credentials });

/**
 * A client from another library for one thing Bun's cannot do: sign a POST policy, which is what
 * holds an upload to a size when the api is not the one receiving it. Everything else still goes
 * through the client above — see `signUpload` for why this one has to exist.
 */
export const artifactsPolicySigner = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT.origin,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
  // The bucket goes in the path rather than the hostname: MinIO answers on a bare host, where a
  // bucket cannot be a subdomain, and S3 serves either form.
  forcePathStyle: true,
});
