import { afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  INVALID_PARAMS,
  PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server';
import { Value } from '@sinclair/typebox/value';
import { StatusMap } from 'elysia';
import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose';
import { NotFoundError } from '#lib/errors.ts';
import { REDACTED } from '#lib/redact-secrets.ts';
import { DeploymentResponseSchema } from '#routes/api/apps/[appId]/deployments/model.ts';
import { AppResponseSchema, ListAppsResponseSchema } from '#routes/api/apps/model.ts';
import { ORIGIN, send, sendJson } from '#tests/controllers/support/api.ts';
import { DEFAULT_CONFIG } from '#tests/services/support/fixtures.ts';

const { auth, AppsServicePlugin, DeploymentsServicePlugin } = await import('#services/plugins.ts');
const { OAUTH_ISSUER, OAUTH_JWKS_URL } = await import('#lib/auth/oauth-issuer.ts');
const { MCP_RESOURCE, MCP_RESOURCE_METADATA_URL, MCP_SCOPE } = await import('#lib/mcp/auth.ts');
const appsService = AppsServicePlugin.decorator.appsService;
const deploymentsService = DeploymentsServicePlugin.decorator.deploymentsService;
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
const SKILL_URI = 'skill://nibrun/deploy-to-nibrun/SKILL.md';
const SKILL_DIRECTORY = new URL('../../../../skills/deploy-to-nibrun/', import.meta.url);

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
    scope: MCP_SCOPE,
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
  const name = method === 'resources/read' ? params.uri : params.name;
  return sendJson({
    method: 'POST',
    url: MCP_URL,
    headers: {
      ...HEADERS,
      'mcp-protocol-version': protocolVersion,
      ...(modern ? { 'mcp-method': method } : {}),
      ...(modern && typeof name === 'string' ? { 'mcp-name': name } : {}),
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

function ownedApp() {
  return Value.Parse(AppResponseSchema, {
    id: 'mcp-app',
    ownerId,
    name: 'MCP example',
    slug: 'mcp-example',
    config: { ...DEFAULT_CONFIG, environment: { API_KEY: REDACTED } },
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
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ['header'],
  });
});

test.each(['tools/list', 'skills/list', 'skills/get', 'resources/read'])(
  'unauthenticated %s receives a discovery challenge without querying apps',
  async (method) => {
    const list = spyOn(appsService, 'list');
    const response = await rpc({ method });
    expect(response.status).toBe(StatusMap.Unauthorized);
    expect(response.headers.get('www-authenticate')).toContain(MCP_RESOURCE_METADATA_URL);
    expect(list).not.toHaveBeenCalled();
  },
);

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

test.each(['other:read', 'offline_access'])(
  'a resource-bound token with only %s cannot substitute for MCP permission',
  async (scope) => {
    const token = await accessToken({ claims: { ...accessTokenClaims(), scope } });
    const response = await rpc({ method: 'tools/list', token });
    expect(response.status).toBe(StatusMap.Forbidden);
    expect(response.headers.get('www-authenticate')).toContain('insufficient_scope');
    expect(response.headers.get('www-authenticate')).toContain(MCP_SCOPE);
    expect(response.headers.get('www-authenticate')).toContain(MCP_RESOURCE_METADATA_URL);
  },
);

test.each([
  ['issuer', { iss: 'https://untrusted.example' }],
  ['audience', { aud: 'https://other-resource.example' }],
  ['expiry', { exp: 1 }],
  ['not-before time', { nbf: Math.floor(Date.now() / MS_PER_SECOND) + FUTURE_OFFSET_SECONDS }],
  ['scope type', { scope: [MCP_SCOPE] }],
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

describe.each(PROTOCOL_VERSIONS)('MCP %s', (protocolVersion) => {
  test('imports the canonical deployment skill with matching frontmatter, bytes and digest', async () => {
    const token = await accessToken();
    const listing = await rpc({ method: 'skills/list', token, protocolVersion });
    const { result } = await rpcBody(listing);
    expect(result.skills).toHaveLength(1);
    expect(result.nextCursor).toBeUndefined();
    const skill = result.skills[0];
    expect(skill.uri).toBe(SKILL_URI);

    const resources = await rpc({ method: 'resources/list', token, protocolVersion });
    expect((await rpcBody(resources)).result.resources).toEqual([
      expect.objectContaining({
        uri: SKILL_URI,
        name: skill.frontmatter.name,
        description: skill.frontmatter.description,
        mimeType: 'text/markdown',
      }),
    ]);

    const metadata = await rpc({
      method: 'skills/get',
      params: { uri: SKILL_URI },
      token,
      protocolVersion,
    });
    expect((await rpcBody(metadata)).result.skill).toEqual(skill);

    const source = await Bun.file(new URL('SKILL.md', SKILL_DIRECTORY)).text();
    expect(skill.frontmatter).toEqual(Bun.YAML.parse(source.match(/^---\n([\s\S]*?)\n---\n/)![1]!));
    expect(await readdir(SKILL_DIRECTORY, { recursive: true })).toEqual(['SKILL.md']);
    expect(skill.resources).toEqual([
      {
        uri: SKILL_URI,
        digest: `sha256:${createHash('sha256').update(source).digest('hex')}`,
        size: Buffer.byteLength(source),
      },
    ]);

    const resource = await rpc({
      method: 'resources/read',
      params: { uri: SKILL_URI },
      token,
      protocolVersion,
    });
    expect((await rpcBody(resource)).result.contents).toEqual([
      { uri: SKILL_URI, mimeType: 'text/markdown', text: source },
    ]);
  });

  test.each([
    ['skills/get', {}],
    ['skills/get', { uri: 'skill://nibrun/missing/SKILL.md' }],
    ['skills/list', { cursor: 'unknown' }],
    ['resources/read', { uri: 'skill://nibrun/deploy-to-nibrun/../../AGENTS.md' }],
    ['resources/read', { uri: 'file:///etc/passwd' }],
  ] as const)(
    'rejects invalid skill requests: %s %j',
    async function rejectsSkillRequest(...[method, params]) {
      const response = await rpc({ method, params, token: await accessToken(), protocolVersion });
      expect((await rpcBody(response)).error.code).toBe(INVALID_PARAMS);
    },
  );

  test('uses the verified token identity without a separate account lookup', async () => {
    const accountLookup = spyOn(context.internalAdapter, 'findUserById').mockRejectedValue(
      new Error('MCP authorization must not query account state'),
    );
    const list = spyOn(appsService, 'list').mockResolvedValue([]);
    const sub = crypto.randomUUID();
    const response = await rpc({
      method: 'tools/call',
      params: { name: 'list_apps', arguments: {} },
      token: await accessToken({ claims: { ...accessTokenClaims(), sub } }),
      protocolVersion,
    });
    expect((await rpcBody(response)).result.structuredContent).toEqual({ apps: [] });
    expect(list).toHaveBeenCalledWith({ ownerId: sub });
    expect(accountLookup).not.toHaveBeenCalled();
  });

  test('advertises read tools using the existing API response schemas', async () => {
    const response = await rpc({
      method: 'tools/list',
      token: await accessToken(),
      protocolVersion,
    });
    const { result } = await rpcBody(response);
    expect(result.tools).toHaveLength(2);
    expect(result.tools[0]).toMatchObject({
      name: 'list_apps',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: [MCP_SCOPE] }] },
    });
    expect(result.tools[0].outputSchema.properties.apps.items.required).toEqual(
      ListAppsResponseSchema.properties.apps.items.required,
    );
    expect(
      result.tools[0].outputSchema.properties.apps.items.properties.computeUsage.anyOf,
    ).toContainEqual({ type: 'null' });
    expect(JSON.stringify(result.tools[0].outputSchema)).not.toContain('"nullable"');
    expect(result.tools[1]).toMatchObject({
      name: 'get_app',
      inputSchema: { required: ['appId'], additionalProperties: false },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: [MCP_SCOPE] }] },
    });
    const output = result.tools[1].outputSchema.properties;
    expect(output.app.required).toEqual(AppResponseSchema.required);
    expect(output.currentDeployment.anyOf[0].required).toEqual(DeploymentResponseSchema.required);
    expect(output.currentDeployment.anyOf).toContainEqual({ type: 'null' });
    expect(JSON.stringify(result.tools[1].outputSchema)).not.toContain('"nullable"');
  });

  test('passes only the verified account identity to the existing app service', async () => {
    const app = ownedApp();
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
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
    expect(list).toHaveBeenCalledWith({ ownerId });
  });

  test('gets the owned app, newest deployment and platform URL with redacted configuration', async () => {
    const app = ownedApp();
    const newest = Value.Parse(DeploymentResponseSchema, {
      id: 'deployment-new',
      appId: app.id,
      artifactId: 'artifact-1',
      config: app.config,
      state: 'failed',
      message: 'The app did not start.',
      createdAt: new Date().toISOString(),
      restartCount: 0,
    });
    const get = spyOn(appsService, 'get').mockResolvedValue(app);
    const list = spyOn(deploymentsService, 'list').mockResolvedValue([
      newest,
      Value.Parse(DeploymentResponseSchema, {
        ...newest,
        id: 'deployment-old',
        state: 'superseded',
      }),
    ]);
    const response = await rpc({
      method: 'tools/call',
      params: { name: 'get_app', arguments: { appId: app.id } },
      token: await accessToken(),
      protocolVersion,
    });
    const { result } = await rpcBody(response);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      app,
      currentDeployment: newest,
      url: 'https://mcp-example.apps.test',
    });
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
    expect(get).toHaveBeenCalledWith({ appId: app.id, ownerId });
    expect(list).toHaveBeenCalledWith({ appId: app.id, ownerId });
  });

  test('returns no current deployment before the first release', async () => {
    const app = ownedApp();
    spyOn(appsService, 'get').mockResolvedValue(app);
    spyOn(deploymentsService, 'list').mockResolvedValue([]);
    const response = await rpc({
      method: 'tools/call',
      params: { name: 'get_app', arguments: { appId: app.id } },
      token: await accessToken(),
      protocolVersion,
    });
    const { result } = await rpcBody(response);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.currentDeployment).toBeNull();
  });

  test.each(['missing-app', 'other-owner-app'])(
    'does not read deployments or disclose details for an inaccessible app: %s',
    async (appId) => {
      const get = spyOn(appsService, 'get').mockRejectedValue(new NotFoundError('App not found.'));
      const list = spyOn(deploymentsService, 'list');
      const response = await rpc({
        method: 'tools/call',
        params: { name: 'get_app', arguments: { appId } },
        token: await accessToken(),
        protocolVersion,
      });
      const { result } = await rpcBody(response);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(get).toHaveBeenCalledWith({ appId, ownerId });
      expect(list).not.toHaveBeenCalled();
    },
  );

  test.each([{}, { appId: '-invalid' }, { appId: 'mcp-app', ownerId: 'other-owner' }])(
    'refuses invalid get_app arguments: %j',
    async (args) => {
      const get = spyOn(appsService, 'get');
      const list = spyOn(deploymentsService, 'list');
      const response = await rpc({
        method: 'tools/call',
        params: { name: 'get_app', arguments: args },
        token: await accessToken(),
        protocolVersion,
      });
      const body = await rpcBody(response);
      expect(body.error ?? body.result?.isError).toBeTruthy();
      expect(get).not.toHaveBeenCalled();
      expect(list).not.toHaveBeenCalled();
    },
  );

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
    capabilities: {
      tools: {},
      resources: {},
      extensions: { 'io.modelcontextprotocol/skills': {} },
    },
  });
});

test('advertises the skills extension through current protocol discovery', async () => {
  const response = await rpc({
    method: 'server/discover',
    token: await accessToken(),
    protocolVersion: '2026-07-28',
  });
  expect((await rpcBody(response)).result.capabilities.extensions).toEqual({
    'io.modelcontextprotocol/skills': {},
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
  expect((await rpcBody(response)).result.tools).toHaveLength(2);
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
