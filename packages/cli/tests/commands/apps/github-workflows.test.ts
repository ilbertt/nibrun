import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as prompts from '@clack/prompts';
import { createCli } from '@parshjs/core';
import { createFilesContext } from '@parshjs/files';
import { commandTree } from '#command-tree.gen.ts';
import { createApi } from '#lib/api.ts';
import { CredentialsSchema } from '#lib/credentials.ts';
import { confirmAndRemoveGitHubWorkflow } from '#lib/github-workflows.ts';

const API_URL = 'https://nibrun.test';
const APP = { id: 'app-1', name: 'server', slug: 'server-slug', state: 'active' };
const WORKFLOW = {
  id: 'workflow-1',
  repository: 'owner/repo',
  workflow: 'deploy.yml',
  branch: 'main',
  environment: 'production',
};
const SET_FLAGS = ['--repository', 'owner/repo', '--workflow', 'deploy.yml', '--branch', 'main'];
const SUCCESS_STATUS = 200;
const UNAUTHORIZED_STATUS = 401;
const FORBIDDEN_STATUS = 403;
const SERVER_ERROR_STATUS = 500;
const NOT_FOUND_STATUS = 404;
const CREATED_STATUS = 201;
const NO_CONTENT_STATUS = 204;
const OWNER_TOKEN = 'owner-session-token';

let directory: string;
let output: string[];
let errors: string[];
let requests: { url: string; method: string; authorization: string | null; body: unknown }[];
let savedWorkflow: typeof WORKFLOW | null;
let lookupStatus: number;
let mutationStatus: number;

beforeEach(async function prepareCli() {
  directory = await mkdtemp(join(tmpdir(), 'nib-github-workflows-'));
  output = [];
  errors = [];
  requests = [];
  savedWorkflow = WORKFLOW;
  lookupStatus = SUCCESS_STATUS;
  mutationStatus = SUCCESS_STATUS;
  spyOn(process.stdout, 'write').mockImplementation(function captureOutput(chunk) {
    output.push(String(chunk));
    return true;
  });
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(apiResponse, { preconnect: fetch.preconnect }),
  );
});

afterEach(async function restoreCli() {
  mock.restore();
  await rm(directory, { recursive: true, force: true });
});

async function workflowCli(signedIn = true) {
  const files = createFilesContext({
    basePath: directory,
    files: { credentials: { filename: 'credentials.json', schema: CredentialsSchema } },
  });
  const credentials = signedIn ? { apiUrl: API_URL, accessToken: OWNER_TOKEN } : null;
  if (credentials) {
    await files.credentials.write(credentials);
  }
  return createCli({
    programName: 'nib',
    tree: commandTree,
    context: { apiUrl: API_URL, files, api: createApi({ baseUrl: API_URL, credentials }) },
    onError: function captureError({ error, exit }) {
      errors.push(error.message);
      return exit(1);
    },
  });
}

function apiResponse(...args: Parameters<typeof fetch>): Promise<Response> {
  return Promise.resolve(responseFor(args));
}

function responseFor([resource, init]: Parameters<typeof fetch>): Response {
  const url = String(resource);
  const method = init?.method ?? 'GET';
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
  requests.push({
    url,
    method,
    authorization: new Headers(init?.headers).get('authorization'),
    body,
  });
  if (url === `${API_URL}/api/apps` && method === 'GET') {
    return Response.json({ apps: [APP] });
  }
  if (url === `${API_URL}/api/apps/${APP.id}/trusted-workflows` && method === 'GET') {
    if (lookupStatus !== SUCCESS_STATUS || !savedWorkflow) {
      return Response.json(
        { error: 'Trusted workflow unavailable.' },
        {
          status: lookupStatus === SUCCESS_STATUS ? NOT_FOUND_STATUS : lookupStatus,
        },
      );
    }
    return Response.json(savedWorkflow);
  }
  if (mutationStatus !== SUCCESS_STATUS) {
    return Response.json({ error: 'Mutation refused.' }, { status: mutationStatus });
  }
  if (method === 'DELETE') {
    return new Response(null, { status: NO_CONTENT_STATUS });
  }
  return Response.json(
    { id: WORKFLOW.id, ...body },
    {
      status: method === 'POST' ? CREATED_STATUS : SUCCESS_STATUS,
    },
  );
}

function commandArguments({
  command,
  flags,
}: {
  command: string;
  flags: readonly string[] | undefined;
}): string[] {
  return ['apps', 'github-workflows', command, '--app', APP.name, '--json', ...(flags ?? [])];
}

function mutations() {
  return requests.filter(function mutation(request) {
    return request.method !== 'GET';
  });
}

test('show resolves the parent app selector and prints the saved workflow as JSON', async function show() {
  const cli = await workflowCli();
  expect(await cli.run(commandArguments({ command: 'show', flags: undefined }))).toBe(0);
  expect(JSON.parse(output.join(''))).toEqual({ appId: APP.id, workflow: WORKFLOW });
  expect(
    requests.map(function addressed(request) {
      return request.url;
    }),
  ).toEqual([`${API_URL}/api/apps`, `${API_URL}/api/apps/${APP.id}/trusted-workflows`]);
  expect(
    requests.every(function authenticated(request) {
      return request.authorization === `Bearer ${OWNER_TOKEN}`;
    }),
  ).toBe(true);
});

test('show reports an unconfigured workflow without treating 404 as a failure', async function missing() {
  savedWorkflow = null;
  const cli = await workflowCli();
  expect(await cli.run(commandArguments({ command: 'show', flags: undefined }))).toBe(0);
  expect(JSON.parse(output.join(''))).toEqual({ appId: APP.id, workflow: null });
});

test('show renders all saved fields for a person', async function humanOutput() {
  const cli = await workflowCli();
  expect(await cli.run(['apps', '--app', APP.slug, 'github-workflows', 'show'])).toBe(0);
  for (const expected of [
    WORKFLOW.repository,
    WORKFLOW.workflow,
    WORKFLOW.branch,
    WORKFLOW.environment,
    WORKFLOW.id,
  ]) {
    expect(output.join('')).toContain(expected);
  }
});

test('set creates a workflow after 404 and sends the complete trusted configuration', async function create() {
  savedWorkflow = null;
  const cli = await workflowCli();
  expect(
    await cli.run(
      commandArguments({ command: 'set', flags: [...SET_FLAGS, '--environment', 'production'] }),
    ),
  ).toBe(0);
  expect(mutations()).toEqual([
    {
      url: `${API_URL}/api/apps/${APP.id}/trusted-workflows`,
      method: 'POST',
      authorization: `Bearer ${OWNER_TOKEN}`,
      body: {
        repository: 'owner/repo',
        workflow: 'deploy.yml',
        branch: 'main',
        environment: 'production',
      },
    },
  ]);
  expect(JSON.parse(output.join(''))).toEqual({ appId: APP.id, workflow: WORKFLOW });
});

test.each([
  { environmentFlags: [] },
  { environmentFlags: ['--environment', ''] },
  { environmentFlags: ['--environment', '   '] },
])(
  'set replaces the saved workflow by its ID and clears an omitted or blank environment $environmentFlags',
  async function replace({ environmentFlags }) {
    const cli = await workflowCli();
    expect(
      await cli.run(
        commandArguments({ command: 'set', flags: [...SET_FLAGS, ...environmentFlags] }),
      ),
    ).toBe(0);
    expect(mutations()).toEqual([
      {
        url: `${API_URL}/api/apps/${APP.id}/trusted-workflows/${WORKFLOW.id}`,
        method: 'PUT',
        authorization: `Bearer ${OWNER_TOKEN}`,
        body: {
          repository: 'owner/repo',
          workflow: 'deploy.yml',
          branch: 'main',
          environment: null,
        },
      },
    ]);
    expect(JSON.parse(output.join('')).workflow.environment).toBeNull();
  },
);

test.each([UNAUTHORIZED_STATUS, FORBIDDEN_STATUS, SERVER_ERROR_STATUS])(
  'set never creates over a failed lookup with status %i',
  async function refused(status) {
    lookupStatus = status;
    const cli = await workflowCli();
    expect(await cli.run(commandArguments({ command: 'set', flags: SET_FLAGS }))).toBe(1);
    expect(errors.join('')).toContain(`api answered ${status}`);
    expect(mutations()).toEqual([]);
    expect(output).toEqual([]);
  },
);

test.each(['repository', 'workflow', 'branch'])(
  'set requires %s for full replacement',
  async function required(flag) {
    const omittedValue = SET_FLAGS[SET_FLAGS.indexOf(`--${flag}`) + 1];
    const flags = SET_FLAGS.filter(function omitFlag(value) {
      return value !== `--${flag}` && value !== omittedValue;
    });
    const cli = await workflowCli();
    expect(await cli.run(commandArguments({ command: 'set', flags }))).toBe(1);
    expect(requests).toEqual([]);
  },
);

test.each(['show', 'set', 'remove'])(
  'configuration command %s requires owner login',
  async function signedOut(command) {
    const cli = await workflowCli(false);
    expect(
      await cli.run(commandArguments({ command, flags: command === 'set' ? SET_FLAGS : [] })),
    ).toBe(1);
    expect(errors).toEqual(['Not signed in. Run `nib login`.']);
    expect(requests).toEqual([]);
  },
);

test('configuration commands demand --app when there is no terminal', async function noApp() {
  const cli = await workflowCli();
  expect(await cli.run(['apps', 'github-workflows', 'show', '--json'])).toBe(1);
  expect(errors.join('')).toContain('--app');
  expect(requests).toEqual([]);
});

test('remove refuses to change trust without --yes when there is no terminal', async function confirmation() {
  const cli = await workflowCli();
  expect(await cli.run(commandArguments({ command: 'remove', flags: undefined }))).toBe(1);
  expect(errors.join('')).toContain('Pass --yes');
  expect(mutations()).toEqual([]);
});

test('remove deletes the saved workflow ID with owner authentication and emits clean JSON', async function remove() {
  const cli = await workflowCli();
  expect(await cli.run(commandArguments({ command: 'remove', flags: ['--yes'] }))).toBe(0);
  expect(mutations()).toEqual([
    {
      url: `${API_URL}/api/apps/${APP.id}/trusted-workflows/${WORKFLOW.id}`,
      method: 'DELETE',
      authorization: `Bearer ${OWNER_TOKEN}`,
      body: null,
    },
  ]);
  expect(JSON.parse(output.join(''))).toEqual({
    appId: APP.id,
    workflowId: WORKFLOW.id,
    removed: true,
  });
});

test('remove names an unconfigured app without making a deletion request', async function missingRemoval() {
  savedWorkflow = null;
  const cli = await workflowCli();
  expect(await cli.run(commandArguments({ command: 'remove', flags: ['--yes'] }))).toBe(1);
  expect(errors).toEqual([`No trusted GitHub workflow configured for ${APP.name}.`]);
  expect(mutations()).toEqual([]);
});

test.each(['set', 'remove'])(
  'a refused %s mutation never prints a success value',
  async function mutationFailure(command) {
    mutationStatus = FORBIDDEN_STATUS;
    const cli = await workflowCli();
    expect(
      await cli.run(
        commandArguments({ command, flags: command === 'set' ? SET_FLAGS : ['--yes'] }),
      ),
    ).toBe(1);
    expect(errors.join('')).toContain('api answered 403');
    expect(output).toEqual([]);
  },
);

test('interactive removal asks for a typed phrase before deleting', async function typedConfirmation() {
  const prompt = spyOn(prompts, 'text').mockImplementation(function answer(options) {
    expect(options.message).toContain(`${WORKFLOW.repository}/${WORKFLOW.workflow}`);
    if (typeof options.validate !== 'function') {
      throw new Error('Expected a typed confirmation validator.');
    }
    expect(options.validate('yes')).toContain('remove workflow');
    expect(options.validate(' REMOVE WORKFLOW ')).toBeUndefined();
    expect(mutations()).toEqual([]);
    return Promise.resolve('remove workflow');
  });
  await confirmAndRemoveGitHubWorkflow({
    api: createApi({
      baseUrl: API_URL,
      credentials: { apiUrl: API_URL, accessToken: OWNER_TOKEN },
    }),
    app: APP,
    yes: false,
    interactive: true,
  });
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(mutations()[0]?.method).toBe('DELETE');
});

test('cancelling the typed removal confirmation leaves the workflow intact', async function cancelled() {
  const cancellation = Symbol('cancelled');
  spyOn(prompts, 'isCancel').mockImplementation(function isCancelled(value): value is symbol {
    return value === cancellation;
  });
  spyOn(prompts, 'text').mockResolvedValue(cancellation);
  await expect(
    confirmAndRemoveGitHubWorkflow({
      api: createApi({
        baseUrl: API_URL,
        credentials: { apiUrl: API_URL, accessToken: OWNER_TOKEN },
      }),
      app: APP,
      yes: false,
      interactive: true,
    }),
  ).rejects.toThrow('Cancelled.');
  expect(mutations()).toEqual([]);
});

test('public group and set help describe the commands and full replacement environment semantics', async function help() {
  const cli = await workflowCli(false);
  expect(await cli.run(['apps', 'github-workflows', '--help'])).toBe(0);
  for (const command of ['show', 'set', 'remove']) {
    expect(output.join('')).toContain(command);
  }
  output = [];
  expect(await cli.run(['apps', 'github-workflows', 'set', '--help'])).toBe(0);
  expect(output.join('')).toContain('Omit or leave empty to remove this restriction.');
  expect(requests).toEqual([]);
});
