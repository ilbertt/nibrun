import { BASE_ERROR_CODES } from '@better-auth/core/error';
import type { AnalyticsEventData } from '@repo/analytics';

type SignInFailureData = Pick<AnalyticsEventData['sign_in_failed'], 'error_code' | 'http_status'>;

const FIRST_HTTP_ERROR_STATUS = 400;
const LAST_HTTP_ERROR_STATUS = 599;

export function signInFailureData(error: unknown): SignInFailureData {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  const status =
    typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
  return {
    error_code:
      typeof code === 'string' && Object.hasOwn(BASE_ERROR_CODES, code) ? code : undefined,
    http_status:
      typeof status === 'number' &&
      Number.isInteger(status) &&
      status >= FIRST_HTTP_ERROR_STATUS &&
      status <= LAST_HTTP_ERROR_STATUS
        ? status
        : undefined,
  };
}
