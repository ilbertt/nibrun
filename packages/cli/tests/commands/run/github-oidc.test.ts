import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCli } from '@parshjs/core';
import { createFilesContext } from '@parshjs/files';
import { GITHUB_ACTIONS_OIDC_AUDIENCE } from '@repo/api-constants';
import { commandTree } from '#command-tree.gen.ts';
import { createApi } from '#lib/api.ts';
import { CredentialsSchema } from '#lib/credentials.ts';
import { maskGitHubSecret } from '#lib/github-oidc.ts';

const nativeFetch = fetch;
const API_URL = 'https://nibrun.test';
const APP_ID = 'app-1';
const DEPLOYMENT_ID = 'deployment-1';
const STORAGE_URL = 'https://storage.test/upload?signature=secret';
const OIDC_REQUEST_SECRET = 'github-request-secret';
const TOKEN_LIFETIME_MS = 300_000;
const SUCCESS_STATUS = 200;
const CREATED_STATUS = 201;
const FORBIDDEN_STATUS = 403;
const REDIRECT_STATUS = 302;
const UNAUTHORIZED_STATUS = 401;
const SERVER_ERROR_STATUS = 500;
const ENV_NAMES = [
  'GITHUB_ACTIONS',
  'ACTIONS_ID_TOKEN_REQUEST_URL',
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
] as const;

let originalEnv: Record<string, string | undefined>;
let directory: string;
let binaryPath: string;
let output: string[];
let errors: string[];
let masks: string[];
let identityBody: string | null;
let identityStatus: number;
let identityRequests: { url: string; headers: Headers }[];
let requests: { url: string; method: string; headers: Headers; body: RequestInit['body'] }[];
let oidc: ReturnType<typeof Bun.serve>;
let failTokens: boolean;
let failure: { url: string; status: number; network: boolean } | undefined;
let renewAfterUpload: boolean;
let issuedTokenCount: number;
let now: number;

beforeEach(async function prepareWorkflow() {
  originalEnv = Object.fromEntries(
    ENV_NAMES.map(function environmentValue(name) {
      return [name, process.env[name]];
    }),
  );
  directory = await mkdtemp(join(tmpdir(), 'nib-github-oidc-'));
  binaryPath = join(directory, 'server');
  await Bun.write(binaryPath, 'compiled-binary');
  output = [];
  errors = [];
  masks = [];
  identityBody = null;
  identityStatus = SUCCESS_STATUS;
  identityRequests = [];
  requests = [];
  failTokens = false;
  failure = undefined;
  renewAfterUpload = false;
  issuedTokenCount = 0;
  now = Date.now();
  oidc = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: function identityResponse(request) {
      identityRequests.push({ url: request.url, headers: new Headers(request.headers) });
      return identityBody === null
        ? Response.json({ value: `github-identity-${identityRequests.length}` })
        : new Response(identityBody, {
            status: identityStatus,
            headers:
              identityStatus === REDIRECT_STATUS
                ? { location: `${oidc.url}untrusted-target` }
                : undefined,
          });
    },
  });
  process.env.GITHUB_ACTIONS = 'true';
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = `${oidc.url}?request=1&audience=wrong-audience`;
  process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = OIDC_REQUEST_SECRET;
  spyOn(process.stdout, 'write').mockImplementation(function captureOutput(chunk) {
    output.push(String(chunk));
    return true;
  });
  spyOn(process.stderr, 'write').mockImplementation(function captureMask(chunk) {
    masks.push(String(chunk));
    return true;
  });
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(apiResponse, { preconnect: fetch.preconnect }),
  );
});

afterEach(async function restoreWorkflow() {
  oidc.stop(true);
  mock.restore();
  for (const name of ENV_NAMES) {
    if (originalEnv[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = originalEnv[name];
    }
  }
  await rm(directory, { recursive: true, force: true });
});

function workflowCli() {
  const files = createFilesContext({
    basePath: directory,
    files: { credentials: { filename: 'credentials.json', schema: CredentialsSchema } },
  });
  const credentialReads = spyOn(files.credentials, 'maybeRead');
  const credentialWrites = spyOn(files.credentials, 'write');
  const cli = createCli({
    programName: 'nib',
    tree: commandTree,
    context: { apiUrl: API_URL, files, api: createApi({ baseUrl: API_URL, credentials: null }) },
    onError: function captureError({ error, exit }) {
      errors.push(error.message);
      return exit(1);
    },
  });
  return { cli, credentialReads, credentialWrites };
}

async function apiResponse(...args: Parameters<typeof fetch>): Promise<Response> {
  const [resource, init] = args;
  const url = String(resource);
  if (url.startsWith(oidc.url.origin)) {
    return await nativeFetch(resource, init);
  }
  requests.push({
    url,
    method: init?.method ?? 'GET',
    headers: new Headers(init?.headers),
    body: init?.body ?? undefined,
  });
  if (url === failure?.url) {
    if (failure.network) {
      throw new Error(
        `private-transport-error ${STORAGE_URL} github-identity-1 deployment-token-1`,
      );
    }
    return Response.json(
      { error: `private-api-error ${STORAGE_URL} github-identity-1 deployment-token-1` },
      { status: failure.status },
    );
  }
  if (url.endsWith('/deployment-tokens')) {
    if (failTokens) {
      return Response.json(
        { error: 'private-token-exchange-error' },
        { status: UNAUTHORIZED_STATUS },
      );
    }
    issuedTokenCount++;
    return Response.json({
      token: `deployment-token-${issuedTokenCount}`,
      expiresAt: new Date(now + TOKEN_LIFETIME_MS).toISOString(),
    });
  }
  if (url === STORAGE_URL) {
    if (renewAfterUpload) {
      now += TOKEN_LIFETIME_MS;
    }
    return new Response(null);
  }
  if (url.endsWith('/artifacts/artifact-1')) {
    return Response.json({ id: 'artifact-1' });
  }
  if (url.endsWith('/artifacts')) {
    return Response.json(
      { artifactId: 'artifact-1', url: STORAGE_URL },
      { status: CREATED_STATUS },
    );
  }
  if (url.endsWith('/deployments')) {
    return Response.json({ id: DEPLOYMENT_ID }, { status: CREATED_STATUS });
  }
  throw new Error(`Unexpected owner API request: ${url}`);
}

function trustedArguments(extra: readonly string[] = []): string[] {
  return ['run', binaryPath, '--github-trusted-oidc', '--app-id', APP_ID, ...extra];
}

test('the command requests GitHub proof and deploys without owner APIs or stored credentials', async () => {
  const { cli, credentialReads, credentialWrites } = workflowCli();
  expect(await cli.run(trustedArguments(['--json']))).toBe(0);
  expect(errors).toEqual([]);
  expect(credentialReads).not.toHaveBeenCalled();
  expect(credentialWrites).not.toHaveBeenCalled();
  expect(identityRequests).toHaveLength(1);
  expect(identityRequests[0]?.headers.get('authorization')).toBe(`Bearer ${OIDC_REQUEST_SECRET}`);
  expect(new URL(identityRequests[0]!.url).searchParams.get('audience')).toBe(
    GITHUB_ACTIONS_OIDC_AUDIENCE,
  );
  expect(
    requests.map(function requestMethod(request) {
      return request.method;
    }),
  ).toEqual(['POST', 'POST', 'PUT', 'PATCH', 'POST']);
  expect(new URL(identityRequests[0]!.url).searchParams.get('request')).toBe('1');
  expect(new URL(identityRequests[0]!.url).searchParams.getAll('audience')).toHaveLength(1);
  expect(requests[0]?.url).toBe(`${API_URL}/api/apps/${APP_ID}/deployment-tokens`);
  expect(requests[0]?.headers.get('authorization')).toBe('Bearer github-identity-1');
  expect(requests[1]?.headers.get('authorization')).toBe('Bearer deployment-token-1');
  expect(requests[2]?.headers.get('authorization')).toBeNull();
  expect(requests.at(-1)?.body).toBe(JSON.stringify({ artifactId: 'artifact-1' }));
  const printed = masks.join('');
  expect(printed).toContain('::add-mask::github-request-secret');
  expect(printed).toContain('::add-mask::github-identity-1');
  expect(printed).toContain('::add-mask::deployment-token-1');
  expect(printed).toContain(`::add-mask::${STORAGE_URL}`);
  expect(JSON.parse(output.join(''))).toEqual({ appId: APP_ID, deploymentId: DEPLOYMENT_ID });
});

test('an upload that outlasts the token renews with new GitHub proof before completion', async () => {
  renewAfterUpload = true;
  spyOn(Date, 'now').mockImplementation(function currentTime() {
    return now;
  });
  const { cli } = workflowCli();
  expect(await cli.run(trustedArguments(['--detach']))).toBe(0);
  expect(identityRequests).toHaveLength(2);
  expect(issuedTokenCount).toBe(2);
  const completion = requests.find(function completionRequest(request) {
    return request.method === 'PATCH';
  });
  expect(completion?.headers.get('authorization')).toBe('Bearer deployment-token-2');
});

test.each([
  { flags: ['--app', 'existing-name'] },
  { flags: ['--name', 'new-name'] },
  { flags: ['--port', '8080'] },
  { flags: ['--extra-public-port=false'] },
  { flags: ['--env', 'NAME=value'] },
  { flags: ['--unset', 'NAME'] },
  { flags: ['--data-folder', '/data'] },
  { flags: ['--sha256', '1234'] },
])('trusted deployment refuses account option $flags', async ({ flags }) => {
  const { cli } = workflowCli();
  expect(await cli.run(trustedArguments(flags))).toBe(1);
  expect(errors[0]).toContain('is not supported with --github-trusted-oidc');
  expect(identityRequests).toHaveLength(0);
  expect(requests).toHaveLength(0);
});

test('trusted deployment refuses waiting for owner-only deployment status', async () => {
  const { cli } = workflowCli();
  expect(await cli.run(trustedArguments(['--detach=false']))).toBe(1);
  expect(errors[0]).toContain('--detach=false is not supported');
  expect(identityRequests).toHaveLength(0);
  expect(requests).toHaveLength(0);
});

test('trusted deployment demands a direct app ID', async () => {
  const { cli } = workflowCli();
  expect(await cli.run(['run', binaryPath, '--github-trusted-oidc'])).toBe(1);
  expect(errors).toEqual(['--github-trusted-oidc requires --app-id for an existing app.']);
  expect(requests).toHaveLength(0);
});

test.each(ENV_NAMES)('trusted deployment refuses missing GitHub context %s', async (name) => {
  delete process.env[name];
  const { cli } = workflowCli();
  expect(await cli.run(trustedArguments())).toBe(1);
  expect(errors).toEqual(['--github-trusted-oidc requires GitHub Actions with id-token: write.']);
  expect(identityRequests).toHaveLength(0);
  expect(requests).toHaveLength(0);
});

test.each([
  { source: 'https://releases.test/server', message: 'requires a compiled file on this machine' },
  {
    source: 'http://releases.test/server?signature=secret',
    message: 'requires a compiled file on this machine',
  },
  { source: './missing-server', message: 'No such file' },
  { source: './server --serve', message: 'using the app startup arguments' },
])('trusted deployment refuses invalid binary input $source', async ({ source, message }) => {
  const { cli } = workflowCli();
  expect(await cli.run(['run', source, '--github-trusted-oidc', '--app-id', APP_ID])).toBe(1);
  expect(errors[0]).toContain(message);
  expect(identityRequests).toHaveLength(0);
  expect(requests).toHaveLength(0);
});

test.each([
  { response: '{}', status: SUCCESS_STATUS },
  { response: JSON.stringify({ value: '' }), status: SUCCESS_STATUS },
  { response: JSON.stringify({ value: 42 }), status: SUCCESS_STATUS },
  { response: 'invalid-json-secret', status: SUCCESS_STATUS },
  { response: 'private-github-error', status: FORBIDDEN_STATUS },
])(
  'invalid GitHub identity response $response/$status is refused safely',
  async ({ response, status }) => {
    identityBody = response;
    identityStatus = status;
    const { cli } = workflowCli();
    expect(await cli.run(trustedArguments(['--json']))).toBe(1);
    expect(errors[0]).toContain(
      status === FORBIDDEN_STATUS
        ? 'GitHub refused the identity token request (HTTP 403)'
        : 'GitHub returned an invalid identity token response',
    );
    expect(errors.join('')).not.toContain(response);
    expect(requests).toHaveLength(0);
    expect(output).toEqual([]);
  },
);

test('mask commands escape percent signs and line breaks on stderr', () => {
  maskGitHubSecret('first%line\r\nsecond-line');
  expect(masks).toEqual(['::add-mask::first%25line%0D%0Asecond-line\n']);
  expect(output).toEqual([]);
});

test('trusted flags remain callable while being omitted from public help', async () => {
  const { cli } = workflowCli();
  expect(await cli.run(['run', binaryPath, '--help'])).toBe(0);
  expect(output.join('')).toContain('--detach');
  expect(output.join('')).not.toContain('--github-trusted-oidc');
  expect(output.join('')).not.toContain('--app-id');
  expect(identityRequests).toHaveLength(0);
  expect(requests).toHaveLength(0);
});

test('a redirected GitHub token request never sends its bearer to the destination', async () => {
  identityBody = '';
  identityStatus = REDIRECT_STATUS;
  const { cli } = workflowCli();
  expect(await cli.run(trustedArguments(['--json']))).toBe(1);
  expect(identityRequests).toHaveLength(1);
  expect(requests).toHaveLength(0);
  expect(output).toEqual([]);
});

test('parent run help also omits trusted deployment flags', async () => {
  const { cli } = workflowCli();
  expect(await cli.run(['run', '--help'])).toBe(0);
  expect(output.join('')).not.toContain('--github-trusted-oidc');
  expect(output.join('')).not.toContain('--app-id');
  expect(identityRequests).toHaveLength(0);
  expect(requests).toHaveLength(0);
});

test('an exchange failure never prints the GitHub proof or API error as an error', async () => {
  failTokens = true;
  const { cli } = workflowCli();
  expect(await cli.run(trustedArguments())).toBe(1);
  expect(errors[0]).toContain('Could not obtain deployment access');
  expect(errors[0]).toContain('HTTP 401');
  expect(errors[0]).toContain('Check the app ID and its trusted GitHub repository');
  expect(errors.join('')).not.toContain('github-identity-1');
  expect(errors.join('')).not.toContain('private-token-exchange-error');
  expect(requests).toHaveLength(1);
});

test('a GitHub connection failure identifies GitHub without exposing the request credential', async () => {
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      function unreachableGitHub() {
        return Promise.reject(
          new Error(`private-github-error ${OIDC_REQUEST_SECRET} ${STORAGE_URL}`),
        );
      },
      { preconnect: fetch.preconnect },
    ),
  );
  const { cli } = workflowCli();
  expect(await cli.run(trustedArguments(['--json']))).toBe(1);
  expect(errors).toEqual([
    'Could not request GitHub identity: GitHub could not be reached. Check network connectivity, then retry.',
  ]);
  expect(requests).toHaveLength(0);
  expect(output).toEqual([]);
});

test.each([
  {
    url: `${API_URL}/api/apps/${APP_ID}/artifacts`,
    status: FORBIDDEN_STATUS,
    message: 'Could not request a binary upload',
  },
  { url: STORAGE_URL, status: SERVER_ERROR_STATUS, message: 'Binary upload failed' },
  {
    url: `${API_URL}/api/apps/${APP_ID}/artifacts/artifact-1`,
    status: SERVER_ERROR_STATUS,
    message: 'Could not confirm the binary upload',
  },
  {
    url: `${API_URL}/api/apps/${APP_ID}/deployments`,
    status: FORBIDDEN_STATUS,
    message: 'Could not create the deployment',
  },
])(
  'server refusal identifies the failed stage $message and status',
  async ({ url, status, message }) => {
    failure = { url, status, network: false };
    const { cli } = workflowCli();
    expect(await cli.run(trustedArguments(['--json']))).toBe(1);
    expect(errors[0]).toContain(message);
    expect(errors[0]).toContain(`HTTP ${status}`);
    expect(errors.join('')).not.toContain('private-api-error');
    expect(errors.join('')).not.toContain('github-identity-1');
    expect(errors.join('')).not.toContain('deployment-token-1');
    expect(errors.join('')).not.toContain(STORAGE_URL);
    expect(output).toEqual([]);
  },
);

test.each([
  {
    url: `${API_URL}/api/apps/${APP_ID}/deployment-tokens`,
    message: 'Could not obtain deployment access: the nibrun API could not be reached',
  },
  {
    url: `${API_URL}/api/apps/${APP_ID}/deployments`,
    message: 'Could not create the deployment: the nibrun API could not be reached',
  },
  { url: STORAGE_URL, message: 'Binary upload failed: storage could not be reached' },
])('network failure identifies the failed service safely: $message', async ({ url, message }) => {
  failure = { url, status: SERVER_ERROR_STATUS, network: true };
  const { cli } = workflowCli();
  expect(await cli.run(trustedArguments(['--json']))).toBe(1);
  expect(errors[0]).toContain(message);
  expect(errors[0]).toContain('Check network connectivity');
  expect(errors.join('')).not.toContain('private-transport-error');
  expect(errors.join('')).not.toContain('github-identity-1');
  expect(errors.join('')).not.toContain('deployment-token-1');
  expect(errors.join('')).not.toContain(STORAGE_URL);
  expect(output).toEqual([]);
});

test('normal deployment still requires owner sign-in', async () => {
  const { cli, credentialReads } = workflowCli();
  expect(await cli.run(['run', binaryPath])).toBe(1);
  expect(errors).toEqual(['Not signed in. Run `nib login`.']);
  expect(credentialReads).toHaveBeenCalledTimes(1);
  expect(requests).toHaveLength(0);
});

test('a direct app ID cannot select an account deployment', async () => {
  const { cli } = workflowCli();
  expect(await cli.run(['run', binaryPath, '--app-id', APP_ID])).toBe(1);
  expect(errors).toEqual(['--app-id requires --github-trusted-oidc.']);
  expect(requests).toHaveLength(0);
});
