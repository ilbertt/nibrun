import { expect, test } from 'bun:test';
import { S3Client } from '@aws-sdk/client-s3';
import { ObjectKeySchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { UnauthorizedError } from '#lib/errors.ts';
import { ArtifactStorageRepository } from '#repositories/artifact-storage.repository.ts';

const MS_PER_SECOND = 1_000;
const SHORT_GRANT_LIFETIME_MS = 30_000;
const LONG_GRANT_LIFETIME_MS = 3_600_000;
const ENDPOINT = 'http://127.0.0.1:1';
const CREDENTIALS = { accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key' };
const BUCKET = 'artifacts';
const INPUT = { objectKey: Value.Parse(ObjectKeySchema, 'uploads/app/artifact'), sizeBytes: 1024 };

function repository() {
  return new ArtifactStorageRepository({
    client: new Bun.S3Client({ ...CREDENTIALS, endpoint: ENDPOINT, bucket: BUCKET }),
    signer: new S3Client({
      endpoint: ENDPOINT,
      region: 'auto',
      forcePathStyle: true,
      credentials: CREDENTIALS,
    }),
    bucket: BUCKET,
  });
}

test('a signed URL covers the declared length and expires before its deployment grant', async () => {
  const expiresAt = new Date(Date.now() + SHORT_GRANT_LIFETIME_MS);
  const url = new URL(await repository().signUpload({ ...INPUT, expiresAt }));
  const signatureDate = url.searchParams.get('X-Amz-Date');
  expect(signatureDate).not.toBeNull();
  const signedAt = new Date(
    (signatureDate ?? '').replace(
      /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
      '$1-$2-$3T$4:$5:$6Z',
    ),
  ).getTime();
  const seconds = Number(url.searchParams.get('X-Amz-Expires'));
  expect(seconds).toBeGreaterThan(0);
  expect(signedAt + seconds * MS_PER_SECOND).toBeLessThanOrEqual(expiresAt.getTime());
  expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toContain('content-length');
  expect(url.pathname).toBe(`/artifacts/${INPUT.objectKey}`);
});

test('expired grants are refused before an upload URL is signed', async () => {
  await expect(
    repository().signUpload({ ...INPUT, expiresAt: new Date(Date.now() - MS_PER_SECOND) }),
  ).rejects.toBeInstanceOf(UnauthorizedError);
});

test('grant expiration never extends the ordinary signed upload lifetime', async () => {
  const storage = repository();
  const ordinary = new URL(await storage.signUpload({ ...INPUT, expiresAt: null }));
  const longerGrant = new URL(
    await storage.signUpload({
      ...INPUT,
      expiresAt: new Date(Date.now() + LONG_GRANT_LIFETIME_MS),
    }),
  );
  expect(longerGrant.searchParams.get('X-Amz-Expires')).toBe(
    ordinary.searchParams.get('X-Amz-Expires'),
  );
});
