import { expect, test } from 'bun:test';
import type {
  OAuthClientRegistrationResponse,
  OAuthTokenResponse,
} from '@better-auth/oauth-provider';
import { StatusMap } from 'elysia';
import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { registeredAccount } from '#tests/controllers/support/accounts.ts';
import { ORIGIN, send, sendJson } from '#tests/controllers/support/api.ts';
import { cimdDocuments } from '#tests/support/cimd.ts';

const { auth } = await import('#services/plugins.ts');
const { MCP_RESOURCE, MCP_SCOPES } = await import('#lib/mcp.ts');
const { OAUTH_ISSUER } = await import('#lib/auth/oauth-issuer.ts');
const AUTH_URL = `${ORIGIN}/api/auth`;
const CALLBACK = 'https://mcp-client.example/callback';
const SCOPES = [...MCP_SCOPES, 'offline_access'].join(' ');
const VERIFIER_LENGTH = 64;
const VERIFIER = 'v'.repeat(VERIFIER_LENGTH);
const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

type TestClient = { clientId: string; privateKey: CryptoKey | undefined };
type ClientMode = 'DCR' | 'CIMD public' | 'CIMD signed';

test.each(['DCR', 'CIMD public', 'CIMD signed'] as const)(
  '%s clients can authorize with PKCE, exchange a code, and refresh',
  async (mode) => {
    const client = await createClient(mode);
    const code = await authorizationCode(client);
    const tokensResponse = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: CALLBACK,
      code_verifier: VERIFIER,
      resource: MCP_RESOURCE.href,
      ...(await clientAuthentication(client)),
    });
    expect(tokensResponse.status, await tokensResponse.clone().text()).toBe(StatusMap.OK);
    const tokens = (await tokensResponse.json()) as OAuthTokenResponse;
    await verifyIssuedToken({ token: tokens.access_token, client });
    expect(tokens.refresh_token).toBeString();
    const refresh = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token!,
      resource: MCP_RESOURCE.href,
      ...(await clientAuthentication(client)),
    });
    expect(refresh.status, await refresh.clone().text()).toBe(StatusMap.OK);
    const refreshed = (await refresh.json()) as OAuthTokenResponse;
    await verifyIssuedToken({ token: refreshed.access_token, client });
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);
  },
);

test('authorization requires PKCE for public clients', async () => {
  const client = await createClient('DCR');
  const query = authorizationQuery(client.clientId);
  query.delete('code_challenge');
  query.delete('code_challenge_method');
  const response = await send({ url: `${AUTH_URL}/oauth2/authorize?${query}` });
  const error = response.headers.get('location') ?? (await response.text());
  expect(error).toContain('invalid_request');
});

test('the code exchange rejects a different PKCE verifier', async () => {
  const client = await createClient('DCR');
  const code = await authorizationCode(client);
  const response = await tokenRequest({
    grant_type: 'authorization_code',
    client_id: client.clientId,
    code,
    redirect_uri: CALLBACK,
    code_verifier: 'x'.repeat(VERIFIER_LENGTH),
    resource: MCP_RESOURCE.href,
  });
  expect(response.ok).toBe(false);
  expect(await response.json()).not.toHaveProperty('access_token');
});

test('signed CIMD clients cannot downgrade their code exchange to public-client authentication', async () => {
  const client = await createClient('CIMD signed');
  const code = await authorizationCode(client);
  const response = await tokenRequest({
    grant_type: 'authorization_code',
    client_id: client.clientId,
    code,
    redirect_uri: CALLBACK,
    code_verifier: VERIFIER,
    resource: MCP_RESOURCE.href,
  });
  expect(response.status).toBe(StatusMap['Bad Request']);
  expect(await response.json()).toMatchObject({ error: 'invalid_client' });
});

test('CIMD clients cannot redirect to a URL absent from their metadata', async () => {
  const client = await createClient('CIMD public');
  const query = authorizationQuery(client.clientId);
  query.set('redirect_uri', 'https://untrusted.example/callback');
  const response = await send({ url: `${AUTH_URL}/oauth2/authorize?${query}` });
  expect(response.headers.get('location') ?? (await response.text())).toContain('invalid_redirect');
  expect(response.headers.get('location')).not.toStartWith('https://untrusted.example');
});

test.each(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'])(
  'protected resource discovery at %s has one canonical audience',
  async (path) => {
    const response = await send({ url: `${ORIGIN}${path}` });
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toMatchObject({
      resource: MCP_RESOURCE.href,
      authorization_servers: [OAUTH_ISSUER],
      scopes_supported: MCP_SCOPES,
    });
  },
);

async function createClient(mode: ClientMode): Promise<TestClient> {
  if (mode === 'DCR') {
    const response = await sendJson({
      method: 'POST',
      url: `${AUTH_URL}/oauth2/register`,
      body: {
        client_name: 'nibrun test client',
        redirect_uris: [CALLBACK],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: SCOPES,
      },
    });
    expect(response.status, await response.clone().text()).toBe(StatusMap.Created);
    const client = (await response.json()) as OAuthClientRegistrationResponse;
    return { clientId: client.client_id, privateKey: undefined };
  }
  const clientId = `https://mcp-client.example/${crypto.randomUUID()}/client.json`;
  const signed = mode === 'CIMD signed';
  const keys = signed ? await generateKeyPair('RS256') : undefined;
  const jwksUri = clientId.replace('client.json', 'jwks.json');
  cimdDocuments.set(clientId, {
    client_id: clientId,
    client_name: 'nibrun test client',
    redirect_uris: [CALLBACK],
    grant_types: ['authorization_code', 'refresh_token'],
    scope: SCOPES,
    token_endpoint_auth_method: signed ? 'private_key_jwt' : 'none',
    token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
    ...(signed ? { jwks_uri: jwksUri, token_endpoint_auth_signing_alg: 'RS256' } : {}),
  });
  if (keys) {
    cimdDocuments.set(jwksUri, {
      keys: [
        { ...(await exportJWK(keys.publicKey)), kid: 'test-client', alg: 'RS256', use: 'sig' },
      ],
    });
  }
  return { clientId, privateKey: keys?.privateKey };
}

function authorizationQuery(clientId: string): URLSearchParams {
  const challenge = new Bun.CryptoHasher('sha256').update(VERIFIER).digest('base64url');
  return new URLSearchParams({
    client_id: clientId,
    redirect_uri: CALLBACK,
    response_type: 'code',
    scope: SCOPES,
    resource: MCP_RESOURCE.href,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'test-state',
  });
}

async function authorizationCode(client: TestClient): Promise<string> {
  const { cookie } = await registeredAccount();
  const response = await send({
    url: `${AUTH_URL}/oauth2/authorize?${authorizationQuery(client.clientId)}`,
    headers: { cookie },
  });
  const location = response.headers.get('location');
  expect(location, await response.clone().text()).toBeString();
  const consentPage = new URL(location!, OAUTH_ISSUER);
  expect(consentPage.pathname).toBe('/consent');
  const consent = await sendJson({
    method: 'POST',
    url: `${AUTH_URL}/oauth2/consent`,
    headers: { cookie, origin: OAUTH_ISSUER },
    body: { accept: true, oauth_query: consentPage.searchParams.toString() },
  });
  expect(consent.status, await consent.clone().text()).toBe(StatusMap.OK);
  const result = (await consent.json()) as Record<string, unknown>;
  expect(result.url).toBeString();
  const redirect = new URL(String(result.url));
  expect(redirect.searchParams.get('state')).toBe('test-state');
  expect(redirect.searchParams.get('iss')).toBe(OAUTH_ISSUER);
  return redirect.searchParams.get('code')!;
}

async function clientAuthentication({
  clientId,
  privateKey,
}: TestClient): Promise<Record<string, string>> {
  if (!privateKey) {
    return { client_id: clientId };
  }
  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'test-client' })
    .setIssuer(clientId)
    .setSubject(clientId)
    .setAudience(`${OAUTH_ISSUER}/api/auth/oauth2/token`)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime('1m')
    .sign(privateKey);
  return {
    client_id: clientId,
    client_assertion_type: CLIENT_ASSERTION_TYPE,
    client_assertion: assertion,
  };
}

function tokenRequest(body: Record<string, string>): Promise<Response> {
  return send({
    method: 'POST',
    url: `${AUTH_URL}/oauth2/token`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
}

async function verifyIssuedToken({ token, client }: { token: string; client: TestClient }) {
  const { payload } = await jwtVerify(token, createLocalJWKSet(await auth.api.getJwks()), {
    issuer: OAUTH_ISSUER,
    audience: MCP_RESOURCE.href,
    typ: 'at+jwt',
  });
  expect(payload.client_id).toBe(client.clientId);
  expect(payload.scope).toContain(MCP_SCOPES[0]);
}
