import type { AppQuotaExceeded } from '@repo/api-client/models';
import { ApiError } from '@repo/api-client/unwrap';
import { APP_QUOTA_EXCEEDED_CODE } from '@repo/api-constants';

const FORBIDDEN_STATUS = 403;

export function appQuotaExceeded(error: unknown): AppQuotaExceeded | undefined {
  if (!(error instanceof ApiError) || error.status !== FORBIDDEN_STATUS) {
    return undefined;
  }
  const body = error.body;
  if (
    typeof body !== 'object' ||
    body === null ||
    !('code' in body) ||
    body.code !== APP_QUOTA_EXCEEDED_CODE ||
    !('error' in body) ||
    typeof body.error !== 'string' ||
    !('appsAllowed' in body) ||
    typeof body.appsAllowed !== 'number' ||
    !Number.isInteger(body.appsAllowed) ||
    body.appsAllowed < 0
  ) {
    return undefined;
  }
  return { code: body.code, error: body.error, appsAllowed: body.appsAllowed };
}
