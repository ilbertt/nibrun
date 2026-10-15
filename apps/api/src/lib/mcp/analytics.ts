import { createHash } from 'node:crypto';
import { ANALYTICS_UUID } from '@repo/analytics/config';

const MCP_ANALYTICS_WINDOW_MINUTES = 30;
const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_SECOND = 1000;
export const MCP_ANALYTICS_WINDOW_MS = MCP_ANALYTICS_WINDOW_MINUTES * MILLISECONDS_PER_MINUTE;
export const MCP_ANALYTICS_COOKIE_SECONDS = MCP_ANALYTICS_WINDOW_MS / MILLISECONDS_PER_SECOND;

export function analyticsKey(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function authorizationRequestKey(query: URLSearchParams): string {
  return analyticsKey(
    JSON.stringify([query.get('client_id'), query.get('state'), query.get('redirect_uri')]),
  );
}

export function analyticsCookie({
  headers,
  name,
}: {
  headers: Headers;
  name: string;
}): string | undefined {
  const value = headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  return value && ANALYTICS_UUID.test(value) ? value : undefined;
}

export async function analyticsResponseData(response: Response): Promise<Record<string, unknown>> {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    return {};
  }
  try {
    const data: unknown = await response.clone().json();
    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function analyticsRedirect({
  response,
  data,
}: {
  response: Response;
  data: Record<string, unknown>;
}): URL | undefined {
  const location =
    response.headers.get('location') ??
    data.redirect_uri ??
    (data.redirect === true ? data.url : undefined);
  if (typeof location !== 'string') {
    return undefined;
  }
  try {
    return new URL(location, 'https://nibrun.invalid');
  } catch {
    return undefined;
  }
}

const OAUTH_ERROR_CODES = new Set([
  'access_denied',
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  'invalid_target',
  'invalid_signature',
  'login_required',
  'consent_required',
  'server_error',
  'temporarily_unavailable',
  'state_not_found',
  'state_mismatch',
  'invalid_code',
  'unable_to_get_user_info',
]);

export function analyticsErrorCode(value: unknown): string {
  return typeof value === 'string' && OAUTH_ERROR_CODES.has(value) ? value : 'unknown';
}

export async function analyticsRequestData(request: Request): Promise<Record<string, unknown>> {
  if (request.method !== 'POST') {
    return {};
  }
  try {
    if (request.headers.get('content-type')?.includes('application/x-www-form-urlencoded')) {
      return Object.fromEntries(new URLSearchParams(await request.clone().text()));
    }
    return await analyticsResponseData(
      new Response(await request.clone().text(), { headers: request.headers }),
    );
  } catch {
    return {};
  }
}
