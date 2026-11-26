import type { AppPatch } from '@repo/api-client/models';
import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';
import { z } from 'zod';
import { UsageError } from '#lib/errors.ts';
import { defineOutput } from '#lib/output.ts';

const FORBIDDEN_STATUS = 403;

type BucketInput = NonNullable<NonNullable<AppPatch['config']>['volumeStorage']>;

async function readBucketConfig(path: string): Promise<BucketInput> {
  const file = path === '-' ? Bun.stdin : Bun.file(path);
  let value: unknown;
  try {
    value = await file.json();
  } catch {
    throw new UsageError(
      'Could not read the bucket configuration. Supply a readable JSON file or pipe JSON to --config-file -.',
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UsageError('The bucket configuration must be a JSON object.');
  }
  // The API validates the complete object against the current public schema.
  return value as BucketInput;
}

export async function setCustomBucket({
  api,
  appId,
  path,
}: {
  api: PublicApiClient;
  appId: string;
  path: string;
}) {
  const volumeStorage = await readBucketConfig(path);
  const reply = await api.api.apps({ appId }).patch({ config: { volumeStorage } });
  if (reply.error?.status === FORBIDDEN_STATUS) {
    throw new UsageError(reply.error.value.error);
  }
  const stored = unwrap(reply).volumeStorage;
  if (!stored) {
    throw new Error('The API did not return the assigned bucket.');
  }
  return stored;
}

export const CUSTOM_BUCKET_OUTPUT = defineOutput({
  schema: z.object({ bucket: z.string(), prefix: z.string() }),
  render: function showBucket({ value, out }) {
    out.success(
      `Configured s3://${value.bucket}/${value.prefix}. The next deployment applies this change.`,
    );
  },
});
