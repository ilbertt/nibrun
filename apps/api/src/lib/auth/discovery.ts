import type { Auth } from '#lib/auth/better-auth.ts';

const DISCOVERY_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
};

export async function oauthDiscoveryResponse({
  request,
  auth,
}: {
  request: Request;
  auth: Pick<Auth, 'handler'>;
}): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: DISCOVERY_HEADERS });
  }
  const response = await auth.handler(request);
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(DISCOVERY_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
