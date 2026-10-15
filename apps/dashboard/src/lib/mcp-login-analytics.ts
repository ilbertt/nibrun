import { BASE_ERROR_CODES } from '@better-auth/core/error';

const CALLBACK_ERRORS = new Set([
  'access_denied',
  'state_not_found',
  'state_mismatch',
  'invalid_code',
  'unable_to_get_user_info',
  'no_code',
  'email_not_found',
]);

export function isMcpLogin(search: string): boolean {
  const query = new URLSearchParams(search);
  return Boolean(query.get('sig') && query.get('client_id'));
}

export function mcpLoginErrorCode(search: string): string | undefined {
  const error = new URLSearchParams(search).get('error');
  return error && (CALLBACK_ERRORS.has(error) || Object.hasOwn(BASE_ERROR_CODES, error))
    ? error
    : undefined;
}
