import { afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server';
import { Value } from '@sinclair/typebox/value';
import { StatusMap } from 'elysia';
import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose';
import { AppResponseSchema, ListAppsResponseSchema } from '#routes/api/apps/model.ts';
import { ORIGIN, send, sendJson } from '#tests/controllers/support/api.ts';
import { DEFAULT_CONFIG } from '#tests/services/support/fixtures.ts';

const { auth, AppsServicePlugin } = await import('#services/plugins.ts');
const { OAUTH_ISSUER, OAUTH_JWKS_URL } = await import('#lib/auth/oauth-issuer.ts');
const { MCP_RESOURCE, MCP_RESOURCE_METADATA_URL, McpScope } = await import('#lib/mcp/auth.ts');
const appsService = AppsServicePlugin.decorator.appsService;
const context = await auth.$context;
const key = await generateKeyPair('EdDSA');
const jwk = { ...(await exportJWK(key.publicKey)), kid: 'mcp-test', alg: 'EdDSA' };
const MCP_URL = `${ORIGIN}/mcp`;
const MS_PER_SECOND = 1000;
const TOKEN_LIFETIME_SECONDS = 300;
const FUTURE_OFFSET_SECONDS = 60;
const HTTP_METHOD_NOT_ALLOWED = StatusMap['Method Not Allowed'];
const PROTOCOL_VERSIONS = ['2025-11-25', '2026-07-28'] as const;
const CLIENT_INFO = { name: 'nibrun-test', version: '1.0.0' };
const HEADERS = {
  accept: 'application/json, text/event-stream',
  host: MCP_RESOURCE.host,
};
const nativeFetch = globalThis.fetch;

let ownerId: string;
let otherOwnerId: string;

beforeAll(async function createAccounts() {
  const owner = await context.internalAdapter.createUser(
    { name: 'MCP owner', email: 'mcp-owner@example.test', emailVerified: true },
    { method: 'admin' },
  );
  const otherOwner = await context.internalAdapter.createUser(
    { name: 'Other MCP owner', email: 'other-mcp-owner@example.test', emailVerified: true },
    { method: 'admin' },
  );
  ownerId = owner.id;
  otherOwnerId = otherOwner.id;
});

beforeEach(function publishSigningKey() {
  spyOn(auth.api, 'getJwks').mockResolvedValue({ keys: [jwk] });
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      function serveJwks(...[input, init]: Parameters<typeof fetch>) {
        const url = input instanceof Request ? input.url : input.toString();
        return url === OAUTH_JWKS_URL
          ? Promise.resolve(Response.json({ keys: [jwk] }))
          : nativeFetch(input, init);
      },
      { preconnect: nativeFetch.preconnect },
    ),
  );
});

afterEach(function restoreMocks() {
  mock.restore();
});

function accessTokenClaims(): JWTPayload {
  const now = Math.floor(Date.now() / MS_PER_SECOND);
  return {
    iss: OAUTH_ISSUER,
    aud: MCP_RESOURCE.href,
    sub: ownerId,
    client_id: 'test-mcp-client',
    scope: McpScope.AppsRead,
    iat: now,
    exp: now + TOKEN_LIFETIME_SECONDS,
  };
}

function accessToken({
  claims = accessTokenClaims(),
  type = 'at+jwt',
}: {
  claims?: Record<string, unknown>;
  type?: string;
} = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'EdDSA', kid: jwk.kid, typ: type })
    .sign(key.privateKey);
}

function rpc({
  method,
  params = {},
  token,
  protocolVersion = PROTOCOL_VERSIONS[0],
}: {
  method: string;
  params?: Record<string, unknown>;
  token?: string;
  protocolVersion?: (typeof PROTOCOL_VERSIONS)[number];
}) {
  const modern = protocolVersion === '2026-07-28';
  return sendJson({
    method: 'POST',
    url: MCP_URL,
    headers: {
      ...HEADERS,
      'mcp-protocol-version': protocolVersion,
      ...(modern ? { 'mcp-method': method } : {}),
      ...(modern && typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: {
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        ...params,
        ...(modern
          ? {
              _meta: {
                [PROTOCOL_VERSION_META_KEY]: protocolVersion,
                [CLIENT_INFO_META_KEY]: CLIENT_INFO,
                [CLIENT_CAPABILITIES_META_KEY]: {},
              },
            }
          : {}),
      },
    },
  });
}

async function rpcBody(response: Response) {
  const text = await response.text();
  expect(response.status, text).toBe(StatusMap.OK);
  const data = text.startsWith('event:')
    ? text
        .split('\n')
        .find((line) => line.startsWith('data:'))!
        .slice('data:'.length)
    : text;
  return JSON.parse(data);
}

test('protected-resource discovery is public and names the existing OAuth issuer', async () => {
  const response = await send({
    url: `${ORIGIN}${new URL(MCP_RESOURCE_METADATA_URL).pathname}`,
  });
  expect(response.status).toBe(StatusMap.OK);
  expect(response.headers.get('access-control-allow-origin')).toBe('*');
  expect(await response.json()).toMatchObject({
    resource: MCP_RESOURCE.href,
    authorization_servers: [OAUTH_ISSUER],
    scopes_supported: [McpScope.AppsRead],
    bearer_methods_supported: ['header'],
  });
});

test('unauthenticated clients receive a discovery challenge without querying apps', async () => {
  const list = spyOn(appsService, 'list');
  const response = await rpc({ method: 'tools/list' });
  expect(response.status).toBe(StatusMap.Unauthorized);
  expect(response.headers.get('www-authenticate')).toContain(MCP_RESOURCE_METADATA_URL);
  expect(list).not.toHaveBeenCalled();
});

test('an account session cannot substitute for an OAuth access token', async () => {
  const result = await auth.api.signInAnonymous({ asResponse: true });
  const cookie = result.headers.get('set-cookie')!;
  const response = await sendJson({
    method: 'POST',
    url: MCP_URL,
    headers: { ...HEADERS, cookie },
    body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  expect(response.status).toBe(StatusMap.Unauthorized);
});

test('a valid token without the read scope receives an insufficient-scope challenge', async () => {
  const token = await accessToken({ claims: { ...accessTokenClaims(), scope: 'other:read' } });
  const response = await rpc({ method: 'tools/list', token });
  expect(response.status).toBe(StatusMap.Forbidden);
  expect(response.headers.get('www-authenticate')).toContain('insufficient_scope');
  expect(response.headers.get('www-authenticate')).toContain(McpScope.AppsRead);
  expect(response.headers.get('www-authenticate')).toContain(MCP_RESOURCE_METADATA_URL);
});

test.each([
  ['issuer', { iss: 'https://untrusted.example' }],
  ['audience', { aud: 'https://other-resource.example' }],
  ['expiry', { exp: 1 }],
  ['scope type', { scope: [McpScope.AppsRead] }],
  ['sender-constrained token', { cnf: { jkt: 'requires-proof' } }],
] as const)(
  'rejects an invalid %s before querying apps',
  async function rejectsClaims(...[_name, overrides]) {
    const list = spyOn(appsService, 'list');
    const claims = { ...accessTokenClaims(), ...overrides };
    const response = await rpc({ method: 'tools/list', token: await accessToken({ claims }) });
    expect(response.status).toBe(StatusMap.Unauthorized);
    expect(list).not.toHaveBeenCalled();
  },
);

test.each([
  ['subject', { sub: '' }],
  ['numeric subject', { sub: 123 }],
  ['client', { client_id: '' }],
  ['numeric client', { client_id: 123 }],
  ['unknown account', { sub: 'deleted-account' }],
] as const)(
  'rejects an invalid %s account identity',
  async function rejectsAccount(...[_name, overrides]) {
    const response = await rpc({
      method: 'tools/list',
      token: await accessToken({ claims: { ...accessTokenClaims(), ...overrides } }),
    });
    expect(response.status).toBe(StatusMap.Forbidden);
  },
);

test('rejects a token issued in the future', async () => {
  const claims = {
    ...accessTokenClaims(),
    iat: Math.floor(Date.now() / MS_PER_SECOND) + FUTURE_OFFSET_SECONDS,
  };
  const response = await rpc({ method: 'tools/list', token: await accessToken({ claims }) });
  expect(response.status).toBe(StatusMap.Forbidden);
});

test('rejects tokens without an expiry', async () => {
  const { exp: _expiry, ...claims } = accessTokenClaims();
  const response = await rpc({ method: 'tools/list', token: await accessToken({ claims }) });
  expect(response.status).toBe(StatusMap.Unauthorized);
});

test('rejects an ID token signed by the same issuer', async () => {
  const token = await accessToken({ type: 'JWT' });
  const response = await rpc({ method: 'tools/list', token });
  expect(response.status).toBe(StatusMap.Unauthorized);
});

test('rejects a forged signature even when the key ID matches', async () => {
  const untrusted = await generateKeyPair('EdDSA');
  const token = await new SignJWT(accessTokenClaims())
    .setProtectedHeader({ alg: 'EdDSA', kid: jwk.kid, typ: 'at+jwt' })
    .sign(untrusted.privateKey);
  const response = await rpc({ method: 'tools/list', token });
  expect(response.status).toBe(StatusMap.Unauthorized);
});

test('rejects anonymous accounts even with an otherwise valid access token', async () => {
  const anonymous = await auth.api.signInAnonymous();
  const claims = { ...accessTokenClaims(), sub: anonymous.user.id };
  const response = await rpc({ method: 'tools/list', token: await accessToken({ claims }) });
  expect(response.status).toBe(StatusMap.Forbidden);
});

describe.each(PROTOCOL_VERSIONS)('MCP %s', (protocolVersion) => {
  test('advertises the read tool using the existing API response schema', async () => {
    const response = await rpc({
      method: 'tools/list',
      token: await accessToken(),
      protocolVersion,
    });
    const { result } = await rpcBody(response);
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]).toMatchObject({
      name: 'list_apps',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: [McpScope.AppsRead] }] },
    });
    expect(result.tools[0].outputSchema.properties.apps.items.required).toEqual(
      ListAppsResponseSchema.properties.apps.items.required,
    );
    expect(
      result.tools[0].outputSchema.properties.apps.items.properties.computeUsage.anyOf,
    ).toContainEqual({ type: 'null' });
    expect(JSON.stringify(result.tools[0].outputSchema)).not.toContain('"nullable"');
  });

  test('passes only the verified account identity to the existing app service', async () => {
    const app = Value.Parse(AppResponseSchema, {
      id: 'mcp-app',
      ownerId,
      name: 'MCP example',
      slug: 'mcp-example',
      config: DEFAULT_CONFIG,
      hostnames: [
        {
          hostname: 'mcp-example.apps.test',
          kind: 'platform',
          state: 'active',
          dcvTarget: null,
          edgeErrors: [],
          createdAt: new Date().toISOString(),
        },
      ],
      state: 'active',
      activation: 'on-request',
      idleTimeoutMs: 300_000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      volumeUsage: null,
      computeUsage: null,
      expiresAt: null,
    });
    const list = spyOn(appsService, 'list').mockResolvedValue([app]);
    const response = await rpc({
      method: 'tools/call',
      params: { name: 'list_apps', arguments: {} },
      token: await accessToken(),
      protocolVersion,
    });
    const { result } = await rpcBody(response);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ apps: [app] });
    expect(list).toHaveBeenCalledWith({ ownerId });
  });

  test('cannot retain another account identity between requests', async () => {
    const list = spyOn(appsService, 'list').mockResolvedValue([]);
    for (const sub of [ownerId, otherOwnerId]) {
      const response = await rpc({
        method: 'tools/call',
        params: { name: 'list_apps', arguments: {} },
        token: await accessToken({ claims: { ...accessTokenClaims(), sub } }),
        protocolVersion,
      });
      expect((await rpcBody(response)).result.isError).not.toBe(true);
      expect(list).toHaveBeenLastCalledWith({ ownerId: sub });
    }
  });

  test('refuses caller-supplied account identities', async () => {
    const list = spyOn(appsService, 'list');
    const response = await rpc({
      method: 'tools/call',
      params: { name: 'list_apps', arguments: { ownerId: otherOwnerId } },
      token: await accessToken(),
      protocolVersion,
    });
    const body = await rpcBody(response);
    expect(body.error ?? body.result?.isError).toBeTruthy();
    expect(list).not.toHaveBeenCalled();
  });

  test('does not expose internal service errors to the client', async () => {
    spyOn(appsService, 'list').mockRejectedValue(new Error('database-password-must-stay-private'));
    const response = await rpc({
      method: 'tools/call',
      params: { name: 'list_apps', arguments: {} },
      token: await accessToken(),
      protocolVersion,
    });
    const body = await rpcBody(response);
    expect(body.result.isError).toBe(true);
    expect(JSON.stringify(body)).not.toContain('database-password-must-stay-private');
  });
});

test('supports the existing initialization handshake', async () => {
  const response = await rpc({
    method: 'initialize',
    params: { protocolVersion: PROTOCOL_VERSIONS[0], clientInfo: CLIENT_INFO, capabilities: {} },
    token: await accessToken(),
  });
  expect((await rpcBody(response)).result).toMatchObject({
    protocolVersion: PROTOCOL_VERSIONS[0],
    serverInfo: { name: 'nibrun' },
    capabilities: { tools: {} },
  });
});

test('rejects an unexpected browser origin', async () => {
  const response = await sendJson({
    method: 'POST',
    url: MCP_URL,
    headers: { ...HEADERS, origin: 'https://untrusted.example' },
    body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  expect(response.status).toBe(StatusMap.Forbidden);
});

test('accepts the configured browser origin', async () => {
  const response = await sendJson({
    method: 'POST',
    url: MCP_URL,
    headers: {
      ...HEADERS,
      origin: MCP_RESOURCE.origin,
      'mcp-protocol-version': PROTOCOL_VERSIONS[0],
      authorization: `Bearer ${await accessToken()}`,
    },
    body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  expect((await rpcBody(response)).result.tools).toHaveLength(1);
});

test.each(['untrusted.example', `${MCP_RESOURCE.hostname}.untrusted.example`])(
  'rejects an unexpected Host header: %s',
  async (host) => {
    const list = spyOn(appsService, 'list');
    const response = await sendJson({
      method: 'POST',
      url: MCP_URL,
      headers: { ...HEADERS, host },
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(response.status).toBe(StatusMap.Forbidden);
    expect(list).not.toHaveBeenCalled();
  },
);

test('rejects a missing Host header', async () => {
  const response = await sendJson({
    method: 'POST',
    url: MCP_URL,
    headers: { accept: HEADERS.accept },
    body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  expect(response.status).toBe(StatusMap.Forbidden);
});

test.each(['GET', 'DELETE'])('stateless MCP does not retain %s sessions', async (method) => {
  const response = await send({
    method,
    url: MCP_URL,
    headers: { ...HEADERS, authorization: `Bearer ${await accessToken()}` },
  });
  expect(response.status).toBe(HTTP_METHOD_NOT_ALLOWED);
});

test.each(['/mcp/missing', '/.well-known/missing'])(
  'does not serve the dashboard at %s',
  async (path) => {
    const response = await send({ url: `${ORIGIN}${path}` });
    expect(response.status).toBe(StatusMap['Not Found']);
  },
);
