import { afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  INVALID_PARAMS,
  McpServer,
  PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server';
import { DEFAULT_LOG_TIMERANGE } from '@repo/api-constants';
import { DirectoryListingSchema, TenantLogRecordSchema } from '@repo/protocol';
import { HranaStmtResultSchema, HranaStmtSchema } from '@repo/sqlite';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { StatusMap } from 'elysia';
import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose';
import { ArtifactSchema } from '#lib/api/artifact.ts';
import { SqliteConnectionSchema } from '#lib/api/sqlite-connection.ts';
import { BadRequestError, ForbiddenError, NotFoundError } from '#lib/errors.ts';
import { DIRECTORY_READ_TIMEOUT_MS } from '#lib/filesystem/timeouts.ts';
import { DeploymentTargetSchema } from '#lib/mcp/tools/shared/deployment-target.ts';
import { MCP_TOOL_NAMES } from '#lib/mcp/tools/shared/tool-names.ts';
import { REDACTED } from '#lib/redact-secrets.ts';
import { CreateArtifactBodySchema } from '#routes/api/apps/[appId]/artifacts/model.ts';
import { StreamLogsQuerySchema } from '#routes/api/apps/[appId]/deployments/[deploymentId]/logs/model.ts';
import { DeploymentResponseSchema } from '#routes/api/apps/[appId]/deployments/model.ts';
import {
  AppResponseSchema,
  CreateAppRequestSchema,
  ListAppsResponseSchema,
} from '#routes/api/apps/model.ts';
import { ORIGIN, send, sendJson } from '#tests/controllers/support/api.ts';
import { DEFAULT_CONFIG } from '#tests/services/support/fixtures.ts';

const {
  auth,
  AppsServicePlugin,
  ArtifactsServicePlugin,
  DeploymentsServicePlugin,
  LogsServicePlugin,
  FilesystemServicePlugin,
  SqliteServicePlugin,
} = await import('#services/plugins.ts');
const { OAUTH_ISSUER, OAUTH_JWKS_URL } = await import('#lib/auth/oauth-issuer.ts');
const { MCP_RESOURCE, MCP_RESOURCE_METADATA_URL, MCP_SCOPE } = await import('#lib/mcp/auth.ts');
const { fromTypeBox } = await import('#lib/mcp/schema.ts');
const { DEPLOY_TO_NIBRUN_SKILL_URI } = await import('#lib/mcp/skills.ts');
const { registerTool } = await import('#lib/mcp/tools/shared/register-tool.ts');
const { MCP_TOOL_META } = await import('#lib/mcp/tools/shared/tool-meta.ts');
const appsService = AppsServicePlugin.decorator.appsService;
const artifactsService = ArtifactsServicePlugin.decorator.artifactsService;
const deploymentsService = DeploymentsServicePlugin.decorator.deploymentsService;
const logsService = LogsServicePlugin.decorator.logsService;
const filesystemService = FilesystemServicePlugin.decorator.filesystemService;
const sqliteService = SqliteServicePlugin.decorator.sqliteService;
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
const SKILL_NAMES = ['deploy-to-nibrun', 'setup-app'];
const SKILLS_DIRECTORY = new URL('../../../../skills/', import.meta.url);

const BINARY_URL = 'https://files.example.test/app';
const NATIVE_DOWNLOAD_URL = 'https://files.example.test/?signature=temporary-download-token';
const MCP_CLIENT_ID = 'test-mcp-client';
const NATIVE_BINARY = { download_url: NATIVE_DOWNLOAD_URL, file_id: 'file-mcp-binary' };
const UPLOAD_URL = 'https://uploads.example.test/binary?signature=upload-token';
const BINARY_SHA256 = 'a94d242b9587cc191df91f21b3ac236714b02ce453730e17b0ddf17cb138eb1e';
const ARTIFACT = Value.Parse(ArtifactSchema, {
  id: 'mcp-artifact',
  appId: 'mcp-app',
  digest: BINARY_SHA256,
  sizeBytes: 4096,
  objectKey: `sha256/${BINARY_SHA256}`,
  originalFileName: 'app',
  createdAt: new Date().toISOString(),
});
const DEPLOYMENT = Value.Parse(DeploymentResponseSchema, {
  id: 'mcp-deployment',
  appId: ARTIFACT.appId,
  artifactId: ARTIFACT.id,
  config: DEFAULT_CONFIG,
  state: 'pending',
  createdAt: new Date().toISOString(),
  restartCount: 0,
});

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
    client_id: MCP_CLIENT_ID,
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
  params?: Record<string, unknown> & { _meta?: Record<string, unknown> };
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
                ...params._meta,
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

test('shared tool registration keeps extension metadata and server-owned authorization metadata', () => {
  const server = new McpServer({ name: 'metadata-test', version: '1.0.0' });
  const schema = fromTypeBox(Type.Object({}));
  const registered = registerTool({
    server,
    name: 'metadata',
    config: {
      inputSchema: schema,
      outputSchema: schema,
      _meta: { 'test/metadata': true, securitySchemes: [{ type: 'noauth' }] },
    },
    callback: function metadata() {
      return { content: [], structuredContent: {} };
    },
  });
  expect(registered._meta).toEqual({ 'test/metadata': true, ...MCP_TOOL_META });
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
  test.each(SKILL_NAMES)('imports %s with matching frontmatter, bytes and digest', async (name) => {
    const uri =
      name === 'deploy-to-nibrun' ? DEPLOY_TO_NIBRUN_SKILL_URI : `skill://nibrun/${name}/SKILL.md`;
    const directory = new URL(`${name}/`, SKILLS_DIRECTORY);
    const token = await accessToken();
    const listing = await rpc({ method: 'skills/list', token, protocolVersion });
    const { result } = await rpcBody(listing);
    expect(result.skills).toHaveLength(SKILL_NAMES.length);
    expect(result.nextCursor).toBeUndefined();
    const skill = result.skills.find((entry: { uri: string }) => entry.uri === uri);
    expect(skill).toBeDefined();

    const resources = await rpc({ method: 'resources/list', token, protocolVersion });
    expect((await rpcBody(resources)).result.resources).toContainEqual(
      expect.objectContaining({
        uri,
        name: skill.frontmatter.name,
        description: skill.frontmatter.description,
        mimeType: 'text/markdown',
      }),
    );

    const metadata = await rpc({
      method: 'skills/get',
      params: { uri },
      token,
      protocolVersion,
    });
    expect((await rpcBody(metadata)).result.skill).toEqual(skill);

    const source = await Bun.file(new URL('SKILL.md', directory)).text();
    expect(skill.frontmatter).toEqual(Bun.YAML.parse(source.match(/^---\n([\s\S]*?)\n---\n/)![1]!));
    expect(await readdir(directory, { recursive: true })).toEqual(['SKILL.md']);
    expect(skill.resources).toEqual([
      {
        uri,
        digest: `sha256:${createHash('sha256').update(source).digest('hex')}`,
        size: Buffer.byteLength(source),
      },
    ]);

    const resource = await rpc({
      method: 'resources/read',
      params: { uri },
      token,
      protocolVersion,
    });
    expect((await rpcBody(resource)).result.contents).toEqual([
      { uri, mimeType: 'text/markdown', text: source },
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
      params: { name: MCP_TOOL_NAMES.listApps, arguments: {} },
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
    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      MCP_TOOL_NAMES.listApps,
      MCP_TOOL_NAMES.getApp,
      MCP_TOOL_NAMES.readLogs,
      MCP_TOOL_NAMES.deployApp,
      MCP_TOOL_NAMES.prepareDeploy,
      MCP_TOOL_NAMES.listFiles,
      MCP_TOOL_NAMES.queryDatabase,
    ]);
    expect(result.tools[0]).toMatchObject({
      name: MCP_TOOL_NAMES.listApps,
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
      name: MCP_TOOL_NAMES.getApp,
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

  test('advertises a finite log read using the existing log schemas', async () => {
    const response = await rpc({
      method: 'tools/list',
      token: await accessToken(),
      protocolVersion,
    });
    const { result } = await rpcBody(response);
    const tool = result.tools.find(
      (entry: { name: string }) => entry.name === MCP_TOOL_NAMES.readLogs,
    );
    expect(tool).toMatchObject({
      inputSchema: { required: ['appId'], additionalProperties: false },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      _meta: MCP_TOOL_META,
    });
    expect(tool.inputSchema.properties.timerange).toEqual(
      JSON.parse(JSON.stringify(StreamLogsQuerySchema.properties.timerange)),
    );
    expect(tool.inputSchema.properties.follow).toBeUndefined();
    expect(tool.inputSchema.properties.deploymentId).toBeUndefined();
    expect(tool.outputSchema.properties.logs.items).toEqual(
      JSON.parse(JSON.stringify(TenantLogRecordSchema)),
    );
  });

  test.each([undefined, '30s', '2h'])(
    'reads available deployment logs without following, with timerange %s',
    async (timerange) => {
      const get = spyOn(appsService, 'get').mockResolvedValue(ownedApp());
      const latest = spyOn(deploymentsService, 'getLatestDeployment').mockResolvedValue(DEPLOYMENT);
      const logs = [
        Value.Parse(TenantLogRecordSchema, {
          _time: new Date().toISOString(),
          _msg: 'App started',
          hostId: 'mcp-host',
          SOURCE: 'tenant',
          appId: ARTIFACT.appId,
          deploymentId: DEPLOYMENT.id,
          stream: 'stdout',
          sourceId: 'mcp-source',
          sequence: 0,
        }),
      ];
      const open = spyOn(logsService, 'openStream').mockResolvedValue(
        (async function* records() {
          yield* logs;
        })(),
      );
      const response = await rpc({
        method: 'tools/call',
        params: {
          name: MCP_TOOL_NAMES.readLogs,
          arguments: {
            appId: ARTIFACT.appId,
            ...(timerange === undefined ? {} : { timerange }),
          },
        },
        token: await accessToken(),
        protocolVersion,
      });
      const { result } = await rpcBody(response);
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({ logs });
      expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
      expect(get).toHaveBeenCalledWith({ appId: ARTIFACT.appId, ownerId });
      expect(latest).toHaveBeenCalledWith({ appId: ARTIFACT.appId, ownerId });
      expect(open).toHaveBeenCalledWith({
        appId: ARTIFACT.appId,
        deploymentId: DEPLOYMENT.id,
        ownerId,
        timerange: timerange ?? DEFAULT_LOG_TIMERANGE,
        follow: false,
        signal: expect.any(AbortSignal),
      });
    },
  );

  test('finishes with an empty log result when no records are available', async () => {
    spyOn(appsService, 'get').mockResolvedValue(ownedApp());
    spyOn(deploymentsService, 'getLatestDeployment').mockResolvedValue(DEPLOYMENT);
    spyOn(logsService, 'openStream').mockResolvedValue(
      (async function* emptyLogs() {
        yield* [];
      })(),
    );
    const response = await rpc({
      method: 'tools/call',
      params: {
        name: MCP_TOOL_NAMES.readLogs,
        arguments: { appId: ARTIFACT.appId },
      },
      token: await accessToken(),
      protocolVersion,
    });
    expect((await rpcBody(response)).result.structuredContent).toEqual({ logs: [] });
  });

  test('returns empty logs before the first deployment without opening a log stream', async () => {
    spyOn(appsService, 'get').mockResolvedValue(ownedApp());
    spyOn(deploymentsService, 'getLatestDeployment').mockResolvedValue(null);
    const open = spyOn(logsService, 'openStream');
    const response = await rpc({
      method: 'tools/call',
      params: { name: MCP_TOOL_NAMES.readLogs, arguments: { appId: ARTIFACT.appId } },
      token: await accessToken(),
      protocolVersion,
    });
    const { result } = await rpcBody(response);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ logs: [] });
    expect(open).not.toHaveBeenCalled();
  });

  test('does not read deployments or logs for an inaccessible app', async () => {
    const get = spyOn(appsService, 'get').mockRejectedValue(new NotFoundError('App not found.'));
    const latest = spyOn(deploymentsService, 'getLatestDeployment');
    const open = spyOn(logsService, 'openStream');
    const response = await rpc({
      method: 'tools/call',
      params: { name: MCP_TOOL_NAMES.readLogs, arguments: { appId: ARTIFACT.appId } },
      token: await accessToken({ claims: { ...accessTokenClaims(), sub: otherOwnerId } }),
      protocolVersion,
    });
    const { result } = await rpcBody(response);
    expect(result.isError).toBe(true);
    expect(get).toHaveBeenCalledWith({ appId: ARTIFACT.appId, ownerId: otherOwnerId });
    expect(latest).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  test('scopes log access to the verified account and hides inaccessible deployment details', async () => {
    const get = spyOn(appsService, 'get').mockResolvedValue(ownedApp());
    const latest = spyOn(deploymentsService, 'getLatestDeployment').mockResolvedValue(DEPLOYMENT);
    const open = spyOn(logsService, 'openStream').mockRejectedValue(
      new NotFoundError('Deployment not found.'),
    );
    const response = await rpc({
      method: 'tools/call',
      params: {
        name: MCP_TOOL_NAMES.readLogs,
        arguments: { appId: ARTIFACT.appId },
      },
      token: await accessToken({ claims: { ...accessTokenClaims(), sub: otherOwnerId } }),
      protocolVersion,
    });
    const { result } = await rpcBody(response);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([{ type: 'text', text: 'Unable to complete request.' }]);
    expect(get).toHaveBeenCalledWith({ appId: ARTIFACT.appId, ownerId: otherOwnerId });
    expect(latest).toHaveBeenCalledWith({ appId: ARTIFACT.appId, ownerId: otherOwnerId });
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: ARTIFACT.appId,
        deploymentId: DEPLOYMENT.id,
        ownerId: otherOwnerId,
      }),
    );
  });

  test('handles errors encountered while reading log records', async () => {
    spyOn(appsService, 'get').mockResolvedValue(ownedApp());
    spyOn(deploymentsService, 'getLatestDeployment').mockResolvedValue(DEPLOYMENT);
    spyOn(logsService, 'openStream').mockResolvedValue(
      (async function* failedLogs() {
        yield* [];
        throw new Error('log-store-password-must-stay-private');
      })(),
    );
    const response = await rpc({
      method: 'tools/call',
      params: {
        name: MCP_TOOL_NAMES.readLogs,
        arguments: { appId: ARTIFACT.appId },
      },
      token: await accessToken(),
      protocolVersion,
    });
    const body = await rpcBody(response);
    expect(body.result.isError).toBe(true);
    expect(JSON.stringify(body)).not.toContain('log-store-password-must-stay-private');
  });

  test.each([
    {},
    { deploymentId: DEPLOYMENT.id },
    { appId: '-invalid' },
    { appId: ARTIFACT.appId, deploymentId: DEPLOYMENT.id },
    { appId: ARTIFACT.appId, timerange: 'forever' },
    { appId: ARTIFACT.appId, timerange: '0s' },
    { appId: ARTIFACT.appId, follow: true },
    { appId: ARTIFACT.appId, ownerId: 'other-owner' },
  ])('refuses invalid read_logs arguments: %j', async (args) => {
    const get = spyOn(appsService, 'get');
    const latest = spyOn(deploymentsService, 'getLatestDeployment');
    const open = spyOn(logsService, 'openStream');
    const response = await rpc({
      method: 'tools/call',
      params: { name: MCP_TOOL_NAMES.readLogs, arguments: args },
      token: await accessToken(),
      protocolVersion,
    });
    const body = await rpcBody(response);
    expect(body.error ?? body.result?.isError).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
    expect(latest).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  test('advertises the directory contract after HTTP filesystem validation runs', async () => {
    const filesystem = await send({
      url: `${ORIGIN}/api/apps/${ARTIFACT.appId}/deployments/${DEPLOYMENT.id}/filesystem`,
    });
    expect(filesystem.status).toBe(StatusMap.Unauthorized);
    const response = await rpc({
      method: 'tools/list',
      token: await accessToken(),
      protocolVersion,
    });
    const { result } = await rpcBody(response);
    const tool = result.tools.find(
      (entry: { name: string }) => entry.name === MCP_TOOL_NAMES.listFiles,
    );
    expect(tool).toMatchObject({
      inputSchema: { required: ['appId'], additionalProperties: false },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: [MCP_SCOPE] }] },
    });
    expect(tool.inputSchema.properties.path).toEqual(
      JSON.parse(JSON.stringify(DirectoryListingSchema.properties.path)),
    );
    expect(tool.inputSchema.properties.deploymentId).toBeUndefined();
    expect(tool.outputSchema.type).toBe(DirectoryListingSchema.type);
    expect(tool.outputSchema.required).toEqual(DirectoryListingSchema.required);
    expect(tool.outputSchema.properties).toEqual(
      JSON.parse(JSON.stringify(DirectoryListingSchema.properties)),
    );
  });

  test.each([
    { path: undefined, expectedPath: '/', truncated: false, sub: 'owner' },
    { path: '/uploads', expectedPath: '/uploads', truncated: true, sub: 'other' },
  ])(
    'lists one volume directory with the verified owner: %j',
    async ({ path, expectedPath, truncated, sub }) => {
      const listing = Value.Parse(DirectoryListingSchema, {
        path: expectedPath,
        entries: [
          {
            name: 'database.sqlite',
            kind: 'file',
            sizeBytes: 4096,
            modifiedAt: new Date().toISOString(),
          },
          {
            name: 'uploads',
            kind: 'directory',
            sizeBytes: 1024,
            modifiedAt: new Date().toISOString(),
          },
        ],
        truncated,
      });
      const get = spyOn(appsService, 'get').mockResolvedValue(ownedApp());
      const latest = spyOn(deploymentsService, 'getLatestDeployment').mockResolvedValue(DEPLOYMENT);
      const read = spyOn(filesystemService, 'readDirectory').mockImplementation(
        function readDirectory({ signal }) {
          expect(signal.aborted).toBe(false);
          return Promise.resolve(listing);
        },
      );
      const identity = sub === 'owner' ? ownerId : otherOwnerId;
      const response = await rpc({
        method: 'tools/call',
        params: {
          name: MCP_TOOL_NAMES.listFiles,
          arguments: {
            appId: ARTIFACT.appId,
            ...(path ? { path } : {}),
          },
        },
        token: await accessToken({ claims: { ...accessTokenClaims(), sub: identity } }),
        protocolVersion,
      });
      const { result } = await rpcBody(response);
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(listing);
      expect(JSON.parse(result.content[0].text)).toEqual(listing);
      expect(get).toHaveBeenCalledWith({ appId: ARTIFACT.appId, ownerId: identity });
      expect(latest).toHaveBeenCalledWith({ appId: ARTIFACT.appId, ownerId: identity });
      expect(get.mock.invocationCallOrder[0]).toBeLessThan(latest.mock.invocationCallOrder[0]!);
      expect(latest.mock.invocationCallOrder[0]).toBeLessThan(read.mock.invocationCallOrder[0]!);
      expect(read).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledWith({
        appId: ARTIFACT.appId,
        deploymentId: DEPLOYMENT.id,
        ownerId: identity,
        path: expectedPath,
        signal: expect.any(AbortSignal),
      });
    },
  );

  test.each([
    {},
    { deploymentId: DEPLOYMENT.id },
    { appId: '-invalid' },
    { appId: ARTIFACT.appId, deploymentId: DEPLOYMENT.id },
    ...['relative', '/../etc', '/data/../../etc', '/uploads/', '/a\\b', '/a\n'].map((path) => ({
      appId: ARTIFACT.appId,
      path,
    })),
    { appId: ARTIFACT.appId, ownerId: 'forged-owner' },
  ])('refuses invalid list_files arguments before reading a volume: %j', async (args) => {
    const get = spyOn(appsService, 'get');
    const latest = spyOn(deploymentsService, 'getLatestDeployment');
    const read = spyOn(filesystemService, 'readDirectory');
    const response = await rpc({
      method: 'tools/call',
      params: { name: MCP_TOOL_NAMES.listFiles, arguments: args },
      token: await accessToken(),
      protocolVersion,
    });
    const body = await rpcBody(response);
    expect(body.error ?? body.result?.isError).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
    expect(latest).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  test.each([new NotFoundError('Deployment not found.'), new Error('private-host-device-path')])(
    'handles inaccessible deployments and host failures without disclosing details: %s',
    async (error) => {
      spyOn(appsService, 'get').mockResolvedValue(ownedApp());
      spyOn(deploymentsService, 'getLatestDeployment').mockResolvedValue(DEPLOYMENT);
      const read = spyOn(filesystemService, 'readDirectory').mockRejectedValue(error);
      const response = await rpc({
        method: 'tools/call',
        params: {
          name: MCP_TOOL_NAMES.listFiles,
          arguments: { appId: ARTIFACT.appId },
        },
        token: await accessToken(),
        protocolVersion,
      });
      const { result } = await rpcBody(response);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain(error.message);
      expect(read).toHaveBeenCalledWith(expect.objectContaining({ ownerId }));
    },
  );

  test('bounds directory reads with the shared filesystem timeout', async () => {
    spyOn(appsService, 'get').mockResolvedValue(ownedApp());
    spyOn(deploymentsService, 'getLatestDeployment').mockResolvedValue(DEPLOYMENT);
    const deadline = new AbortController();
    const timeout = spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const read = spyOn(filesystemService, 'readDirectory').mockImplementation(function expireRead({
      signal,
    }) {
      deadline.abort(new Error('directory deadline expired'));
      expect(signal.aborted).toBe(true);
      return Promise.reject(signal.reason);
    });
    const response = await rpc({
      method: 'tools/call',
      params: {
        name: MCP_TOOL_NAMES.listFiles,
        arguments: { appId: ARTIFACT.appId },
      },
      token: await accessToken(),
      protocolVersion,
    });
    expect((await rpcBody(response)).result.isError).toBe(true);
    expect(timeout).toHaveBeenCalledWith(DIRECTORY_READ_TIMEOUT_MS);
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('does not read deployments or files for an inaccessible app', async () => {
    const get = spyOn(appsService, 'get').mockRejectedValue(new NotFoundError('App not found.'));
    const latest = spyOn(deploymentsService, 'getLatestDeployment');
    const read = spyOn(filesystemService, 'readDirectory');
    const response = await rpc({
      method: 'tools/call',
      params: { name: MCP_TOOL_NAMES.listFiles, arguments: { appId: ARTIFACT.appId } },
      token: await accessToken({ claims: { ...accessTokenClaims(), sub: otherOwnerId } }),
      protocolVersion,
    });
    expect((await rpcBody(response)).result.isError).toBe(true);
    expect(get).toHaveBeenCalledWith({ appId: ARTIFACT.appId, ownerId: otherOwnerId });
    expect(latest).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  test('does not read a volume before the first deployment', async () => {
    spyOn(appsService, 'get').mockResolvedValue(ownedApp());
    const latest = spyOn(deploymentsService, 'getLatestDeployment').mockResolvedValue(null);
    const read = spyOn(filesystemService, 'readDirectory');
    const response = await rpc({
      method: 'tools/call',
      params: { name: MCP_TOOL_NAMES.listFiles, arguments: { appId: ARTIFACT.appId } },
      token: await accessToken(),
      protocolVersion,
    });
    const { result } = await rpcBody(response);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(latest).toHaveBeenCalledWith({ appId: ARTIFACT.appId, ownerId });
    expect(read).not.toHaveBeenCalled();
  });

  test('advertises database queries with file paths and shared SQLite schemas', async () => {
    const response = await rpc({
      method: 'tools/list',
      token: await accessToken(),
      protocolVersion,
    });
    const { result } = await rpcBody(response);
    const tool = result.tools.find(
      (entry: { name: string }) => entry.name === MCP_TOOL_NAMES.queryDatabase,
    );
    expect(tool).toMatchObject({
      inputSchema: {
        required: ['appId', 'sqlite_file_path', 'sql'],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: [MCP_SCOPE] }] },
    });
    expect(Object.keys(tool.inputSchema.properties)).toEqual([
      'appId',
      'sqlite_file_path',
      'sql',
      'args',
      'named_args',
    ]);
    expect(tool.inputSchema.properties.sqlite_file_path).toEqual(
      JSON.parse(JSON.stringify(SqliteConnectionSchema.properties.sqlite_file_path)),
    );
    expect(tool.inputSchema.properties.args).toEqual(
      fromTypeBox(HranaStmtSchema.properties.args)['~standard'].jsonSchema.input({
        target: 'draft-07',
      }),
    );
    expect(tool.outputSchema.properties.result).toEqual(
      fromTypeBox(HranaStmtResultSchema)['~standard'].jsonSchema.output({ target: 'draft-07' }),
    );
  });

  test('queries a file using the verified owner and returns typed database results', async () => {
    const result = {
      cols: [{ name: 'value', decltype: null }],
      rows: [[{ type: 'integer' as const, value: '9007199254740993' }]],
      affected_row_count: 0,
      last_insert_rowid: null,
    };
    const query = spyOn(sqliteService, 'query').mockResolvedValue(result);
    const response = await rpc({
      method: 'tools/call',
      params: {
        name: MCP_TOOL_NAMES.queryDatabase,
        arguments: {
          appId: ARTIFACT.appId,
          sqlite_file_path: '/app.db',
          sql: 'SELECT ? AS value',
          args: [{ type: 'integer', value: '9007199254740993' }],
        },
      },
      token: await accessToken(),
      protocolVersion,
    });
    expect((await rpcBody(response)).result.structuredContent).toEqual({ result });
    expect(query).toHaveBeenCalledWith({
      appId: ARTIFACT.appId,
      ownerId,
      sqlite_file_path: '/app.db',
      stmt: { sql: 'SELECT ? AS value', args: [{ type: 'integer', value: '9007199254740993' }] },
      signal: expect.any(AbortSignal),
    });
  });

  test.each([
    { appId: ARTIFACT.appId, sql: 'SELECT 1' },
    { appId: ARTIFACT.appId, sqlite_file_path: '/app.db' },
    { appId: ARTIFACT.appId, sqlite_file_path: '/app.db', sql: null },
    { appId: ARTIFACT.appId, sqlite_file_path: '/../app.db', sql: 'SELECT 1' },
    {
      appId: ARTIFACT.appId,
      sqlite_file_path: '/app.db',
      sql: 'SELECT 1',
      deploymentId: DEPLOYMENT.id,
    },
    {
      appId: ARTIFACT.appId,
      sqlite_file_path: '/app.db',
      sql: 'SELECT 1',
      url: 'https://api.test/',
    },
  ])('rejects invalid database query arguments: %j', async (args) => {
    const query = spyOn(sqliteService, 'query');
    const response = await rpc({
      method: 'tools/call',
      params: { name: MCP_TOOL_NAMES.queryDatabase, arguments: args },
      token: await accessToken(),
      protocolVersion,
    });
    const body = await rpcBody(response);
    expect(body.error ?? body.result?.isError).toBeTruthy();
    expect(query).not.toHaveBeenCalled();
  });

  test('database query failures use the shared tool error response', async () => {
    spyOn(sqliteService, 'query').mockRejectedValue(new NotFoundError('Private database details'));
    const response = await rpc({
      method: 'tools/call',
      params: {
        name: MCP_TOOL_NAMES.queryDatabase,
        arguments: { appId: ARTIFACT.appId, sqlite_file_path: '/app.db', sql: 'SELECT 1' },
      },
      token: await accessToken(),
      protocolVersion,
    });
    expect((await rpcBody(response)).result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Unable to complete request.' }],
    });
  });

  test('advertises creation and redeployment using the existing API schemas', async () => {
    const response = await rpc({
      method: 'tools/list',
      token: await accessToken(),
      protocolVersion,
    });
    const { result } = await rpcBody(response);
    const tool = result.tools.find(
      (entry: { name: string }) => entry.name === MCP_TOOL_NAMES.deployApp,
    );
    expect(tool).toMatchObject({
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
        idempotentHint: false,
      },
      inputSchema: {
        additionalProperties: false,
        oneOf: [{ required: ['url'] }, { required: ['binary'] }, { required: ['artifactId'] }],
        allOf: [
          ...DeploymentTargetSchema.allOf,
          { not: { required: ['name', 'artifactId'] } },
          { not: { required: ['sha256', 'artifactId'] } },
        ],
      },
      _meta: {
        securitySchemes: [{ type: 'oauth2', scopes: [MCP_SCOPE] }],
        'openai/fileParams': ['binary'],
      },
    });
    expect(tool.description).toContain(MCP_TOOL_NAMES.prepareDeploy);
    expect(tool.description).toContain('Include chatId');
    expect(tool.inputSchema.properties.chatId).toEqual(
      JSON.parse(JSON.stringify(DeploymentResponseSchema.properties.mcp.properties.chatId)),
    );
    expect(tool.description).toContain(DEPLOY_TO_NIBRUN_SKILL_URI);
    expect(tool.inputSchema.required ?? []).toEqual([]);
    expect(tool.inputSchema.properties.name).toEqual(
      JSON.parse(JSON.stringify(CreateAppRequestSchema.properties.name)),
    );
    expect(tool.inputSchema.properties.config).toEqual(
      JSON.parse(JSON.stringify(CreateAppRequestSchema.properties.config)),
    );
    const fetched = CreateArtifactBodySchema.anyOf
      .map((schema) => schema.properties)
      .find((properties) => 'url' in properties)!;
    expect(tool.inputSchema.properties.url).toEqual(JSON.parse(JSON.stringify(fetched.url)));
    expect(tool.inputSchema.properties.sha256).toEqual(JSON.parse(JSON.stringify(fetched.sha256)));
    expect(tool.inputSchema.properties.binary.required).toEqual(['download_url', 'file_id']);
    expect(Object.keys(tool.inputSchema.properties.binary.properties)).toEqual([
      'download_url',
      'file_id',
      'mime_type',
      'file_name',
    ]);
    expect(tool.inputSchema.properties.binary.properties.download_url).toEqual(
      tool.inputSchema.properties.url,
    );
    expect(tool.outputSchema.properties.deployment.required).toEqual(
      DeploymentResponseSchema.required,
    );
    expect(tool.outputSchema.properties.app.required).toEqual(AppResponseSchema.required);
    expect(tool.outputSchema.properties.url).toMatchObject({ type: 'string', format: 'uri' });
    expect(JSON.stringify(tool.outputSchema)).not.toContain('"nullable"');
  });

  test('advertises direct upload preparation and its deployment follow-up', async () => {
    const response = await rpc({
      method: 'tools/list',
      token: await accessToken(),
      protocolVersion,
    });
    const { result } = await rpcBody(response);
    const tool = result.tools.find(
      (entry: { name: string }) => entry.name === MCP_TOOL_NAMES.prepareDeploy,
    );
    expect(tool.description).toContain(MCP_TOOL_NAMES.deployApp);
    expect(tool.description).toContain(DEPLOY_TO_NIBRUN_SKILL_URI);
    expect(tool).toMatchObject({
      inputSchema: {
        required: ['filename', 'sizeBytes'],
        additionalProperties: false,
        allOf: DeploymentTargetSchema.allOf,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: false,
      },
      _meta: MCP_TOOL_META,
    });
    const uploaded = CreateArtifactBodySchema.anyOf
      .map((schema) => schema.properties)
      .find((properties) => 'filename' in properties)!;
    expect(tool.inputSchema.properties.filename).toEqual(
      JSON.parse(JSON.stringify(uploaded.filename)),
    );
    expect(tool.inputSchema.properties.sizeBytes).toEqual(
      JSON.parse(JSON.stringify(uploaded.sizeBytes)),
    );
    expect(tool.outputSchema.properties.app.required).toEqual(AppResponseSchema.required);
    expect(tool.outputSchema.properties.upload.required).toEqual(['artifactId', 'url']);
  });

  test.each([true, false])(
    'prepares an upload and deploys into the same app: new=%s',
    async (isNew) => {
      const app = ownedApp();
      const config = { httpPort: 8080, environment: { API_KEY: 'initial-secret' } };
      const target = isNew ? { name: app.name, config } : { appId: app.id };
      const createApp = spyOn(appsService, 'create').mockResolvedValue(app);
      const getApp = spyOn(appsService, 'get').mockResolvedValue(app);
      const createUpload = spyOn(artifactsService, 'create').mockResolvedValue({
        artifactId: ARTIFACT.id,
        url: UPLOAD_URL,
      });
      const complete = spyOn(artifactsService, 'completeUpload').mockResolvedValue(ARTIFACT);
      const fetch = spyOn(artifactsService, 'createFromUrl');
      const deploy = spyOn(deploymentsService, 'createWithMcpClient').mockResolvedValue(DEPLOYMENT);
      const token = await accessToken();
      const response = await rpc({
        method: 'tools/call',
        params: {
          name: MCP_TOOL_NAMES.prepareDeploy,
          arguments: {
            ...target,
            filename: ARTIFACT.originalFileName,
            sizeBytes: ARTIFACT.sizeBytes,
          },
        },
        token,
        protocolVersion,
      });
      const { result } = await rpcBody(response);
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({
        app,
        upload: { artifactId: ARTIFACT.id, url: UPLOAD_URL },
      });
      expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
      expect(createApp).toHaveBeenCalledTimes(isNew ? 1 : 0);
      if (isNew) {
        expect(createApp).toHaveBeenCalledWith({
          ownerId,
          isAnonymous: false,
          name: app.name,
          config,
        });
      } else {
        expect(getApp).toHaveBeenCalledWith({ appId: app.id, ownerId });
      }
      expect(createUpload).toHaveBeenCalledWith({
        appId: app.id,
        ownerId,
        deploymentGrant: null,
        isAnonymous: false,
        filename: ARTIFACT.originalFileName,
        sizeBytes: ARTIFACT.sizeBytes,
      });
      expect(complete).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(deploy).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain('initial-secret');
      expect(JSON.stringify(result)).not.toContain(token);
      const deployedResponse = await rpc({
        method: 'tools/call',
        params: {
          name: MCP_TOOL_NAMES.deployApp,
          arguments: {
            appId: result.structuredContent.app.id,
            artifactId: result.structuredContent.upload.artifactId,
          },
        },
        token,
        protocolVersion,
      });
      const deployed = (await rpcBody(deployedResponse)).result;
      expect(deployed.isError).not.toBe(true);
      expect(deployed.structuredContent).toEqual({
        app,
        deployment: DEPLOYMENT,
        url: 'https://mcp-example.apps.test',
      });
      expect(createApp).toHaveBeenCalledTimes(isNew ? 1 : 0);
      expect(createUpload).toHaveBeenCalledTimes(1);
      expect(complete).toHaveBeenCalledWith({ appId: app.id, artifactId: ARTIFACT.id, ownerId });
      expect(getApp).toHaveBeenCalledWith({ appId: app.id, ownerId });
      expect(fetch).not.toHaveBeenCalled();
      expect(deploy).toHaveBeenCalledWith({
        appId: app.id,
        ownerId,
        clientId: MCP_CLIENT_ID,
        chatId: undefined,
        artifactId: ARTIFACT.id,
      });
      expect(complete.mock.invocationCallOrder[0]).toBeLessThan(
        deploy.mock.invocationCallOrder[0]!,
      );
      expect(JSON.stringify(deployed)).not.toContain(UPLOAD_URL);
    },
  );

  test.each([true, false])(
    'does not prepare an upload when the app service refuses the target: new=%s',
    async (isNew) => {
      const createApp = spyOn(appsService, 'create').mockRejectedValue(
        new ForbiddenError('App quota exceeded.'),
      );
      const getApp = spyOn(appsService, 'get').mockRejectedValue(
        new NotFoundError('App not found.'),
      );
      const createUpload = spyOn(artifactsService, 'create');
      const target = isNew ? { name: 'New app' } : { appId: ARTIFACT.appId };
      const response = await rpc({
        method: 'tools/call',
        params: {
          name: MCP_TOOL_NAMES.prepareDeploy,
          arguments: { ...target, filename: 'app', sizeBytes: 4096 },
        },
        token: await accessToken({ claims: { ...accessTokenClaims(), sub: otherOwnerId } }),
        protocolVersion,
      });
      expect((await rpcBody(response)).result.isError).toBe(true);
      expect(createApp).toHaveBeenCalledTimes(isNew ? 1 : 0);
      expect(getApp).toHaveBeenCalledTimes(isNew ? 0 : 1);
      if (isNew) {
        expect(createApp).toHaveBeenCalledWith({
          ownerId: otherOwnerId,
          isAnonymous: false,
          name: 'New app',
          config: undefined,
        });
      } else {
        expect(getApp).toHaveBeenCalledWith({ appId: ARTIFACT.appId, ownerId: otherOwnerId });
      }
      expect(createUpload).not.toHaveBeenCalled();
    },
  );

  test.each([
    new BadRequestError('No binary uploaded.'),
    new BadRequestError('The artifact is not a Linux executable.'),
    new NotFoundError('Artifact not found.'),
  ])('does not deploy an uploaded artifact that cannot be finalized: %s', async (error) => {
    const app = ownedApp();
    spyOn(appsService, 'get').mockResolvedValue(app);
    const complete = spyOn(artifactsService, 'completeUpload').mockRejectedValue(error);
    const fetch = spyOn(artifactsService, 'createFromUrl');
    const deploy = spyOn(deploymentsService, 'createWithMcpClient');
    const response = await rpc({
      method: 'tools/call',
      params: {
        name: MCP_TOOL_NAMES.deployApp,
        arguments: { appId: app.id, artifactId: ARTIFACT.id },
      },
      token: await accessToken({ claims: { ...accessTokenClaims(), sub: otherOwnerId } }),
      protocolVersion,
    });
    expect((await rpcBody(response)).result.isError).toBe(true);
    expect(complete).toHaveBeenCalledWith({
      appId: app.id,
      artifactId: ARTIFACT.id,
      ownerId: otherOwnerId,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(deploy).not.toHaveBeenCalled();
  });

  test.each([
    { filename: 'app', sizeBytes: 4096 },
    { name: 'New app', appId: ARTIFACT.appId, filename: 'app', sizeBytes: 4096 },
    { appId: ARTIFACT.appId, config: {}, filename: 'app', sizeBytes: 4096 },
    { name: 'New app', filename: '../app', sizeBytes: 4096 },
    { name: 'New app', filename: 'app', sizeBytes: -1 },
    { name: 'New app', filename: 'app' },
    { name: 'New app', sizeBytes: 4096 },
    { name: 'New app', filename: 'app', sizeBytes: 4096, ownerId: 'caller-selected-owner' },
  ])('rejects invalid upload preparation before calling services: %j', async (args) => {
    const createApp = spyOn(appsService, 'create');
    const getApp = spyOn(appsService, 'get');
    const createUpload = spyOn(artifactsService, 'create');
    const response = await rpc({
      method: 'tools/call',
      params: { name: MCP_TOOL_NAMES.prepareDeploy, arguments: args },
      token: await accessToken(),
      protocolVersion,
    });
    const body = await rpcBody(response);
    expect(body.error ?? body.result?.isError).toBeTruthy();
    expect(createApp).not.toHaveBeenCalled();
    expect(getApp).not.toHaveBeenCalled();
    expect(createUpload).not.toHaveBeenCalled();
  });

  test.each([
    { source: { url: BINARY_URL }, config: undefined },
    {
      source: { binary: NATIVE_BINARY },
      config: { httpPort: 8080, environment: { API_KEY: 'initial-secret' } },
    },
  ])('creates an app and redeploys it using the returned ID: %j', async ({ source, config }) => {
    const app = ownedApp();
    const create = spyOn(appsService, 'create').mockResolvedValue(app);
    const get = spyOn(appsService, 'get').mockResolvedValue(app);
    const fetch = spyOn(artifactsService, 'createFromUrl').mockResolvedValue(ARTIFACT);
    const deploy = spyOn(deploymentsService, 'createWithMcpClient').mockResolvedValue(DEPLOYMENT);
    const token = await accessToken();
    const response = await rpc({
      method: 'tools/call',
      params: {
        name: MCP_TOOL_NAMES.deployApp,
        arguments: { name: app.name, config, ...source },
      },
      token,
      protocolVersion,
    });
    const { result } = await rpcBody(response);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      app,
      deployment: DEPLOYMENT,
      url: 'https://mcp-example.apps.test',
    });
    expect(create).toHaveBeenCalledWith({ ownerId, isAnonymous: false, name: app.name, config });
    expect(get).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ appId: app.id, ownerId, isAnonymous: false }),
    );
    expect(deploy).toHaveBeenCalledWith({
      appId: app.id,
      ownerId,
      clientId: MCP_CLIENT_ID,
      chatId: undefined,
      artifactId: ARTIFACT.id,
    });
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[0]!);
    expect(fetch.mock.invocationCallOrder[0]).toBeLessThan(deploy.mock.invocationCallOrder[0]!);
    expect(JSON.stringify(result)).not.toContain('initial-secret');
    const redeployResponse = await rpc({
      method: 'tools/call',
      params: {
        name: MCP_TOOL_NAMES.deployApp,
        arguments: { appId: result.structuredContent.app.id, ...source },
      },
      token,
      protocolVersion,
    });
    const redeployed = (await rpcBody(redeployResponse)).result;
    expect(redeployed.isError).not.toBe(true);
    expect(redeployed.structuredContent.app.id).toBe(app.id);
    expect(create).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith({ appId: app.id, ownerId });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(deploy).toHaveBeenCalledTimes(2);
  });

  test('does not fetch or deploy a binary when app creation is refused', async () => {
    const create = spyOn(appsService, 'create').mockRejectedValue(
      new ForbiddenError('App quota exceeded.'),
    );
    const fetch = spyOn(artifactsService, 'createFromUrl');
    const deploy = spyOn(deploymentsService, 'createWithMcpClient');
    const response = await rpc({
      method: 'tools/call',
      params: { name: MCP_TOOL_NAMES.deployApp, arguments: { name: 'New app', url: BINARY_URL } },
      token: await accessToken(),
      protocolVersion,
    });
    expect((await rpcBody(response)).result.isError).toBe(true);
    expect(create).toHaveBeenCalledWith({
      ownerId,
      isAnonymous: false,
      name: 'New app',
      config: undefined,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(deploy).not.toHaveBeenCalled();
  });

  test.each(['registered-client', 'https://claude.ai/oauth/mcp-oauth-client-metadata'])(
    'deployment provenance uses the client identity verified in the access token: %s',
    async (clientId) => {
      const app = ownedApp();
      spyOn(appsService, 'get').mockResolvedValue(app);
      spyOn(artifactsService, 'createFromUrl').mockResolvedValue(ARTIFACT);
      const deployment = Value.Parse(DeploymentResponseSchema, {
        ...DEPLOYMENT,
        mcp: { clientId },
      });
      const deploy = spyOn(deploymentsService, 'createWithMcpClient').mockResolvedValue(deployment);
      const token = await accessToken({ claims: { ...accessTokenClaims(), client_id: clientId } });
      const response = await rpc({
        method: 'tools/call',
        params: {
          name: MCP_TOOL_NAMES.deployApp,
          arguments: { appId: app.id, url: BINARY_URL },
          _meta: { clientId: 'forged-client', mcp: { clientId: 'forged-client' } },
        },
        token,
        protocolVersion,
      });
      const { result } = await rpcBody(response);
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent.deployment.mcp).toEqual({ clientId });
      expect(deploy).toHaveBeenCalledWith({
        appId: app.id,
        ownerId,
        artifactId: ARTIFACT.id,
        clientId,
        chatId: undefined,
      });
      expect(JSON.stringify(result)).not.toContain(token);
    },
  );

  test.each([
    { chatId: undefined, session: 'anonymous-session', expected: 'anonymous-session' },
    { chatId: 'known-chat', session: undefined, expected: 'known-chat' },
    { chatId: 'known-chat', session: 'anonymous-session', expected: 'known-chat' },
    { chatId: undefined, session: undefined, expected: undefined },
    { chatId: undefined, session: '', expected: undefined },
    { chatId: undefined, session: true, expected: undefined },
    { chatId: undefined, session: { id: 'invalid-session' }, expected: undefined },
    { chatId: undefined, session: null, expected: undefined },
  ])('records optional chat provenance from input or client metadata: %j', async (input) => {
    const app = ownedApp();
    spyOn(appsService, 'get').mockResolvedValue(app);
    spyOn(artifactsService, 'createFromUrl').mockResolvedValue(ARTIFACT);
    const deploy = spyOn(deploymentsService, 'createWithMcpClient').mockResolvedValue(DEPLOYMENT);
    const response = await rpc({
      method: 'tools/call',
      params: {
        name: MCP_TOOL_NAMES.deployApp,
        arguments: { appId: app.id, url: BINARY_URL, chatId: input.chatId },
        _meta: { 'openai/session': input.session },
      },
      token: await accessToken(),
      protocolVersion,
    });
    expect((await rpcBody(response)).result.isError).not.toBe(true);
    expect(deploy).toHaveBeenCalledWith({
      appId: app.id,
      ownerId,
      artifactId: ARTIFACT.id,
      clientId: MCP_CLIENT_ID,
      chatId: input.expected,
    });
  });

  test.each(['', true, null])('rejects invalid explicit chat IDs: %j', async (chatId) => {
    const get = spyOn(appsService, 'get');
    const fetch = spyOn(artifactsService, 'createFromUrl');
    const deploy = spyOn(deploymentsService, 'createWithMcpClient');
    const response = await rpc({
      method: 'tools/call',
      params: {
        name: MCP_TOOL_NAMES.deployApp,
        arguments: { appId: ARTIFACT.appId, url: BINARY_URL, chatId },
      },
      token: await accessToken(),
      protocolVersion,
    });
    const body = await rpcBody(response);
    expect(body.error ?? body.result?.isError).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(deploy).not.toHaveBeenCalled();
  });

  test('fetches and queues a deployment under the verified account without forwarding its token', async () => {
    const app = ownedApp();
    const get = spyOn(appsService, 'get').mockResolvedValue(app);
    const fetch = spyOn(artifactsService, 'createFromUrl').mockResolvedValue(ARTIFACT);
    const deploy = spyOn(deploymentsService, 'createWithMcpClient').mockResolvedValue(DEPLOYMENT);
    const token = await accessToken();
    const response = await rpc({
      method: 'tools/call',
      params: {
        name: MCP_TOOL_NAMES.deployApp,
        arguments: { appId: app.id, url: BINARY_URL, sha256: BINARY_SHA256 },
      },
      token,
      protocolVersion,
    });
    const { result } = await rpcBody(response);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      app,
      deployment: DEPLOYMENT,
      url: 'https://mcp-example.apps.test',
    });
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith({ appId: app.id, ownerId });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith({
      appId: app.id,
      ownerId,
      deploymentGrant: null,
      isAnonymous: false,
      url: BINARY_URL,
      filename: undefined,
      sha256: BINARY_SHA256,
    });
    expect(deploy).toHaveBeenCalledTimes(1);
    expect(deploy).toHaveBeenCalledWith({
      appId: app.id,
      ownerId,
      clientId: MCP_CLIENT_ID,
      chatId: undefined,
      artifactId: ARTIFACT.id,
    });
    expect(get.mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[0]!);
    expect(fetch.mock.invocationCallOrder[0]).toBeLessThan(deploy.mock.invocationCallOrder[0]!);
    expect(JSON.stringify([fetch.mock.calls, deploy.mock.calls, result])).not.toContain(token);
  });

  test('accepts a URL without a caller checksum', async () => {
    const app = ownedApp();
    spyOn(appsService, 'get').mockResolvedValue(app);
    const fetch = spyOn(artifactsService, 'createFromUrl').mockResolvedValue(ARTIFACT);
    spyOn(deploymentsService, 'createWithMcpClient').mockResolvedValue(DEPLOYMENT);
    const response = await rpc({
      method: 'tools/call',
      params: { name: MCP_TOOL_NAMES.deployApp, arguments: { appId: app.id, url: BINARY_URL } },
      token: await accessToken(),
      protocolVersion,
    });
    expect((await rpcBody(response)).result.isError).not.toBe(true);
    expect(fetch.mock.calls[0]?.[0].sha256).toBeUndefined();
  });

  test.each([true, false])(
    'deploys with the active custom domain URL when the platform hostname is present: %s',
    async (withPlatformHostname) => {
      const original = ownedApp();
      const app = Value.Parse(AppResponseSchema, {
        ...original,
        hostnames: [
          {
            ...original.hostnames[0],
            hostname: 'app.example.com',
            kind: 'custom',
          },
          ...(withPlatformHostname ? original.hostnames : []),
        ],
      });
      spyOn(appsService, 'get').mockResolvedValue(app);
      spyOn(artifactsService, 'createFromUrl').mockResolvedValue(ARTIFACT);
      spyOn(deploymentsService, 'createWithMcpClient').mockResolvedValue(DEPLOYMENT);
      const response = await rpc({
        method: 'tools/call',
        params: { name: MCP_TOOL_NAMES.deployApp, arguments: { appId: app.id, url: BINARY_URL } },
        token: await accessToken(),
        protocolVersion,
      });
      const { result } = await rpcBody(response);
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent.url).toBe('https://app.example.com');
      expect(result.structuredContent.deployment).toEqual(DEPLOYMENT);
    },
  );

  test.each([
    {
      metadata: { file_name: 'native-server', mime_type: 'application/octet-stream' },
      filename: 'native-server',
    },
    { metadata: {}, filename: 'app' },
    { metadata: { file_name: '../../unsafe-name' }, filename: 'app' },
  ])(
    'normalizes a native file descriptor without treating its ID as account identity: %j',
    async ({ metadata, filename }) => {
      const app = ownedApp();
      const get = spyOn(appsService, 'get').mockResolvedValue(app);
      const fetch = spyOn(artifactsService, 'createFromUrl').mockResolvedValue(ARTIFACT);
      const deploy = spyOn(deploymentsService, 'createWithMcpClient').mockResolvedValue(DEPLOYMENT);
      const token = await accessToken();
      const response = await rpc({
        method: 'tools/call',
        params: {
          name: MCP_TOOL_NAMES.deployApp,
          arguments: {
            appId: app.id,
            binary: { ...NATIVE_BINARY, ...metadata, file_id: otherOwnerId },
            sha256: BINARY_SHA256,
          },
        },
        token,
        protocolVersion,
      });
      const { result } = await rpcBody(response);
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent.deployment).toEqual(DEPLOYMENT);
      expect(get).toHaveBeenCalledWith({ appId: app.id, ownerId });
      expect(fetch).toHaveBeenCalledWith({
        appId: app.id,
        ownerId,
        isAnonymous: false,
        deploymentGrant: null,
        url: NATIVE_DOWNLOAD_URL,
        filename,
        sha256: BINARY_SHA256,
      });
      expect(deploy).toHaveBeenCalledWith({
        appId: app.id,
        ownerId,
        clientId: MCP_CLIENT_ID,
        chatId: undefined,
        artifactId: ARTIFACT.id,
      });
      expect(JSON.stringify([fetch.mock.calls, deploy.mock.calls, result])).not.toContain(token);
    },
  );

  test('does not fetch a binary for a missing app or an app owned by another account', async () => {
    const get = spyOn(appsService, 'get').mockRejectedValue(new NotFoundError('App not found.'));
    const create = spyOn(appsService, 'create');
    const fetch = spyOn(artifactsService, 'createFromUrl');
    const deploy = spyOn(deploymentsService, 'createWithMcpClient');
    const response = await rpc({
      method: 'tools/call',
      params: {
        name: MCP_TOOL_NAMES.deployApp,
        arguments: { appId: ARTIFACT.appId, url: BINARY_URL },
      },
      token: await accessToken({ claims: { ...accessTokenClaims(), sub: otherOwnerId } }),
      protocolVersion,
    });
    expect((await rpcBody(response)).result.isError).toBe(true);
    expect(get).toHaveBeenCalledWith({ appId: ARTIFACT.appId, ownerId: otherOwnerId });
    expect(create).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(deploy).not.toHaveBeenCalled();
  });

  test('does not replace a release when the artifact service refuses the binary', async () => {
    spyOn(appsService, 'get').mockResolvedValue(ownedApp());
    spyOn(artifactsService, 'createFromUrl').mockRejectedValue(
      new BadRequestError('The artifact is not a Linux executable.'),
    );
    const deploy = spyOn(deploymentsService, 'createWithMcpClient');
    const response = await rpc({
      method: 'tools/call',
      params: {
        name: MCP_TOOL_NAMES.deployApp,
        arguments: { appId: ARTIFACT.appId, url: BINARY_URL },
      },
      token: await accessToken(),
      protocolVersion,
    });
    expect((await rpcBody(response)).result.isError).toBe(true);
    expect(deploy).not.toHaveBeenCalled();
  });

  test.each([
    { appId: ARTIFACT.appId, url: 'http://files.example.test/app' },
    { appId: ARTIFACT.appId, url: BINARY_URL, sha256: 'wrong-checksum' },
    { appId: ARTIFACT.appId, url: BINARY_URL, ownerId: 'caller-selected-owner' },
    { appId: ARTIFACT.appId, url: BINARY_URL, clientId: 'forged-client' },
    { appId: ARTIFACT.appId, url: BINARY_URL, mcp: { clientId: 'forged-client' } },
    { appId: ARTIFACT.appId },
    { url: BINARY_URL },
    { appId: ARTIFACT.appId, url: BINARY_URL, name: 'unexpected-new-app' },
    { appId: ARTIFACT.appId, url: BINARY_URL, config: {} },
    { name: 'New app', artifactId: ARTIFACT.id },
    { appId: ARTIFACT.appId, artifactId: ARTIFACT.id, url: BINARY_URL },
    { appId: ARTIFACT.appId, artifactId: ARTIFACT.id, binary: NATIVE_BINARY },
    { appId: ARTIFACT.appId, artifactId: ARTIFACT.id, sha256: BINARY_SHA256 },
    { name: '', url: BINARY_URL },
    { name: 'New app', config: { httpPort: 0 }, url: BINARY_URL },
    { name: 'New app', config: { unknown: true }, url: BINARY_URL },
    { name: 'New app', ownerId: 'caller-selected-owner', url: BINARY_URL },
    { name: 'New app', url: BINARY_URL, binary: NATIVE_BINARY },
    { name: 'New app', binary: { file_id: NATIVE_BINARY.file_id } },
    { appId: ARTIFACT.appId, url: BINARY_URL, binary: NATIVE_BINARY },
    { appId: ARTIFACT.appId, binary: { file_id: NATIVE_BINARY.file_id } },
    { appId: ARTIFACT.appId, binary: { download_url: NATIVE_DOWNLOAD_URL } },
    { appId: ARTIFACT.appId, binary: { ...NATIVE_BINARY, file_id: '' } },
    {
      appId: ARTIFACT.appId,
      binary: { ...NATIVE_BINARY, download_url: 'http://files.example.test/' },
    },
    { appId: ARTIFACT.appId, binary: { ...NATIVE_BINARY, mime_type: 123 } },
    { appId: ARTIFACT.appId, binary: { ...NATIVE_BINARY, ownerId: 'caller-selected-owner' } },
    { appId: ARTIFACT.appId, binary: NATIVE_BINARY, ownerId: 'caller-selected-owner' },
    { appId: ARTIFACT.appId, binary: NATIVE_BINARY, sha256: 'wrong-checksum' },
  ])('refuses invalid deployment arguments before calling services: %j', async (args) => {
    const create = spyOn(appsService, 'create');
    const get = spyOn(appsService, 'get');
    const complete = spyOn(artifactsService, 'completeUpload');
    const fetch = spyOn(artifactsService, 'createFromUrl');
    const deploy = spyOn(deploymentsService, 'createWithMcpClient');
    const response = await rpc({
      method: 'tools/call',
      params: { name: MCP_TOOL_NAMES.deployApp, arguments: args },
      token: await accessToken(),
      protocolVersion,
    });
    const body = await rpcBody(response);
    expect(body.error ?? body.result?.isError).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(deploy).not.toHaveBeenCalled();
  });

  test('passes only the verified account identity to the existing app service', async () => {
    const app = ownedApp();
    const list = spyOn(appsService, 'list').mockResolvedValue([app]);
    const response = await rpc({
      method: 'tools/call',
      params: { name: MCP_TOOL_NAMES.listApps, arguments: {} },
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
    const latest = spyOn(deploymentsService, 'getLatestDeployment').mockResolvedValue(newest);
    const response = await rpc({
      method: 'tools/call',
      params: { name: MCP_TOOL_NAMES.getApp, arguments: { appId: app.id } },
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
    expect(latest).toHaveBeenCalledWith({ appId: app.id, ownerId });
  });

  test('returns no current deployment before the first release', async () => {
    const app = ownedApp();
    spyOn(appsService, 'get').mockResolvedValue(app);
    spyOn(deploymentsService, 'getLatestDeployment').mockResolvedValue(null);
    const response = await rpc({
      method: 'tools/call',
      params: { name: MCP_TOOL_NAMES.getApp, arguments: { appId: app.id } },
      token: await accessToken(),
      protocolVersion,
    });
    const { result } = await rpcBody(response);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.currentDeployment).toBeNull();
  });

  test.each([true, false])(
    'returns the active custom domain URL when the platform hostname is present: %s',
    async (withPlatformHostname) => {
      const original = ownedApp();
      const app = Value.Parse(AppResponseSchema, {
        ...original,
        hostnames: [
          {
            ...original.hostnames[0],
            hostname: 'app.example.com',
            kind: 'custom',
          },
          ...(withPlatformHostname ? original.hostnames : []),
        ],
      });
      spyOn(appsService, 'get').mockResolvedValue(app);
      spyOn(deploymentsService, 'getLatestDeployment').mockResolvedValue(null);
      const response = await rpc({
        method: 'tools/call',
        params: { name: MCP_TOOL_NAMES.getApp, arguments: { appId: app.id } },
        token: await accessToken(),
        protocolVersion,
      });
      const { result } = await rpcBody(response);
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent.url).toBe('https://app.example.com');
    },
  );

  test.each(['missing-app', 'other-owner-app'])(
    'does not read deployments or disclose details for an inaccessible app: %s',
    async (appId) => {
      const get = spyOn(appsService, 'get').mockRejectedValue(new NotFoundError('App not found.'));
      const latest = spyOn(deploymentsService, 'getLatestDeployment');
      const response = await rpc({
        method: 'tools/call',
        params: { name: MCP_TOOL_NAMES.getApp, arguments: { appId } },
        token: await accessToken(),
        protocolVersion,
      });
      const { result } = await rpcBody(response);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(get).toHaveBeenCalledWith({ appId, ownerId });
      expect(latest).not.toHaveBeenCalled();
    },
  );

  test.each([{}, { appId: '-invalid' }, { appId: 'mcp-app', ownerId: 'other-owner' }])(
    'refuses invalid get_app arguments: %j',
    async (args) => {
      const get = spyOn(appsService, 'get');
      const latest = spyOn(deploymentsService, 'getLatestDeployment');
      const response = await rpc({
        method: 'tools/call',
        params: { name: MCP_TOOL_NAMES.getApp, arguments: args },
        token: await accessToken(),
        protocolVersion,
      });
      const body = await rpcBody(response);
      expect(body.error ?? body.result?.isError).toBeTruthy();
      expect(get).not.toHaveBeenCalled();
      expect(latest).not.toHaveBeenCalled();
    },
  );

  test('cannot retain another account identity between requests', async () => {
    const list = spyOn(appsService, 'list').mockResolvedValue([]);
    for (const sub of [ownerId, otherOwnerId]) {
      const response = await rpc({
        method: 'tools/call',
        params: { name: MCP_TOOL_NAMES.listApps, arguments: {} },
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
      params: { name: MCP_TOOL_NAMES.listApps, arguments: { ownerId: otherOwnerId } },
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
      params: { name: MCP_TOOL_NAMES.listApps, arguments: {} },
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
  expect((await rpcBody(response)).result.tools).toContainEqual(
    expect.objectContaining({ name: MCP_TOOL_NAMES.listApps }),
  );
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
