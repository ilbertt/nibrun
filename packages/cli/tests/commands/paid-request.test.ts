import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import * as prompts from '@clack/prompts';
import { createCli } from '@parshjs/core';
import {
  APP_QUOTA_EXCEEDED_CODE,
  MAX_PAID_APPS_REQUEST,
  MAX_PAID_RESOURCE_AMOUNT,
  MIN_PAID_APPS_REQUEST,
} from '@repo/api-constants';
import { commandTree } from '#command-tree.gen.ts';
import { createApi } from '#lib/api.ts';
import { completePaidRequest } from '#lib/paid-requests.ts';
import { listedApp } from '#tests/support/api.ts';
import { APP_ID, NAME, SLUG } from '#tests/support/app.ts';

const API_URL = 'https://nibrun.test';
const TOKEN = 'paid-request-owner-token';
const SUCCESS_STATUS = 200;
const SERVICE_UNAVAILABLE_STATUS = 503;
const FORBIDDEN_STATUS = 403;
const APPS_ALLOWED = 3;
const ASKED_TOTAL = 10;
const APP_REQUEST_TYPES = ['custom-bucket', 'always-on'] as const;
const NO_RESOURCE_OPTIONS = {
  'requested-vcpu-count': undefined,
  'requested-memory-mib': undefined,
  'requested-volume-gib': undefined,
};
const RESOURCE_AMOUNTS = {
  requestedVcpuCount: 2,
  requestedMemoryMib: 512,
  requestedVolumeGib: 16,
};
const CURRENT_APP_CONFIG = {
  resources: { vcpuCount: 1, memoryMib: 256 },
  volumeSizeBytes: 8_589_934_592,
};

let output: string[];
let errors: string[];
let requests: { url: string; method: string; authorization: string | null; body: unknown }[];
let responseStatus: number;
let apps: ReturnType<typeof listedApp>[];
let appConfig: typeof CURRENT_APP_CONFIG;

beforeEach(function prepareCli() {
  output = [];
  errors = [];
  requests = [];
  responseStatus = SUCCESS_STATUS;
  apps = [listedApp()];
  appConfig = CURRENT_APP_CONFIG;
  spyOn(process.stdout, 'write').mockImplementation(function captureOutput(chunk) {
    output.push(String(chunk));
    return true;
  });
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(apiResponse, { preconnect: fetch.preconnect }),
  );
});

afterEach(function restoreMocks() {
  mock.restore();
});

function paidRequestCli(signedIn = true) {
  const credentials = signedIn ? { apiUrl: API_URL, accessToken: TOKEN } : null;
  return createCli({
    programName: 'nib',
    tree: commandTree,
    context: {
      apiUrl: API_URL,
      api: createApi({ baseUrl: API_URL, credentials }),
      files: {
        credentials: {
          maybeRead: function maybeRead() {
            return Promise.resolve(credentials);
          },
        },
      },
    },
    onError: function captureError({ error, exit }) {
      errors.push(error.message);
      return exit(1);
    },
  });
}

function paidRequestApi() {
  return createApi({
    baseUrl: API_URL,
    credentials: { apiUrl: API_URL, accessToken: TOKEN },
  });
}

function apiResponse(...args: Parameters<typeof fetch>): Promise<Response> {
  return Promise.resolve(responseFor(args));
}

function responseFor([resource, init]: Parameters<typeof fetch>): Response {
  const url = String(resource);
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
  requests.push({
    url,
    body,
    method: init?.method ?? 'GET',
    authorization: new Headers(init?.headers).get('authorization'),
  });
  if (url === `${API_URL}/api/apps`) {
    if ((init?.method ?? 'GET') === 'GET') {
      return Response.json({ apps });
    }
    return Response.json(
      {
        error: 'Paid apps are coming. How many apps do you need?',
        code: APP_QUOTA_EXCEEDED_CODE,
        appsAllowed: APPS_ALLOWED,
      },
      { status: FORBIDDEN_STATUS },
    );
  }
  if (url === `${API_URL}/api/apps/${APP_ID}`) {
    return Response.json({ ...listedApp(), config: appConfig });
  }
  if (responseStatus !== SUCCESS_STATUS) {
    return Response.json({ error: 'Please retry this request.' }, { status: responseStatus });
  }
  if (url === `${API_URL}/api/paid-requests/resources`) {
    return Response.json({ requestType: 'resources', ...body });
  }
  const requestType = APP_REQUEST_TYPES.find(
    (type) => url === `${API_URL}/api/paid-requests/${type}`,
  );
  if (requestType !== undefined) {
    return Response.json({ requestType, appId: body.appId });
  }
  return Response.json({ requestType: 'apps', requestedAppsAmount: body.requestedAppsAmount });
}

test('paid-request sends an authenticated total and emits one JSON result', async function requestApps() {
  expect(
    await paidRequestCli().run([
      'paid-request',
      '--type',
      'apps',
      '--requested-apps-amount',
      String(ASKED_TOTAL),
      '--json',
    ]),
  ).toBe(0);
  expect(errors).toEqual([]);
  expect(output).toEqual([
    `${JSON.stringify({ requestType: 'apps', requestedAppsAmount: ASKED_TOTAL })}\n`,
  ]);
  expect(requests).toEqual([
    {
      url: `${API_URL}/api/paid-requests/apps`,
      method: 'PUT',
      authorization: `Bearer ${TOKEN}`,
      body: { requestedAppsAmount: ASKED_TOTAL },
    },
  ]);
});

test.each([MIN_PAID_APPS_REQUEST, MAX_PAID_APPS_REQUEST])(
  'the command accepts the boundary total %s',
  async function boundary(amount) {
    expect(
      await paidRequestCli().run([
        'paid-request',
        '--type',
        'apps',
        '--requested-apps-amount',
        String(amount),
        '--json',
      ]),
    ).toBe(0);
    expect(JSON.parse(output.join(''))).toEqual({
      requestType: 'apps',
      requestedAppsAmount: amount,
    });
  },
);

test.each(['0', '-1', '1.5', 'NaN', String(MAX_PAID_APPS_REQUEST + 1)])(
  'invalid total %s is refused before an API call',
  async function invalidAmount(amount) {
    expect(
      await paidRequestCli().run([
        'paid-request',
        '--type',
        'apps',
        '--requested-apps-amount',
        amount,
        '--json',
      ]),
    ).toBe(1);
    expect(requests).toEqual([]);
    expect(output).toEqual([]);
  },
);

test('unsupported types are refused before an API call', async function unsupportedType() {
  expect(
    await paidRequestCli().run([
      'paid-request',
      '--type',
      'custom-domain',
      '--requested-apps-amount',
      '1',
      '--json',
    ]),
  ).toBe(1);
  expect(errors.join('')).toContain('Supported paid request types: apps');
  expect(requests).toEqual([]);
});

test('scripts and JSON require an explicit amount without prompting or submitting', async function missingAmount() {
  const ask = spyOn(prompts, 'text').mockResolvedValue(String(ASKED_TOTAL));
  expect(await paidRequestCli().run(['paid-request', '--type', 'apps', '--json'])).toBe(1);
  expect(errors.join('')).toContain('Pass --requested-apps-amount');
  expect(ask).not.toHaveBeenCalled();
  expect(requests).toEqual([]);
});

test('a terminal can answer the total and can cancel without submitting', async function interactiveAmount() {
  const ask = spyOn(prompts, 'text').mockResolvedValue(String(ASKED_TOTAL));
  const options = {
    ...NO_RESOURCE_OPTIONS,
    type: 'apps' as const,
    'requested-apps-amount': undefined,
    app: undefined,
  };
  expect(await completePaidRequest({ options, interactive: true, api: paidRequestApi() })).toEqual({
    requestType: 'apps',
    requestedAppsAmount: ASKED_TOTAL,
  });
  expect(ask.mock.calls[0]?.[0].message).toContain('in total');
  const cancellation = Symbol('cancel');
  spyOn(prompts, 'isCancel').mockImplementation(function isCancelled(value) {
    return value === cancellation;
  });
  ask.mockResolvedValue(cancellation);
  await expect(
    completePaidRequest({ options, interactive: true, api: paidRequestApi() }),
  ).rejects.toThrow('Cancelled.');
  expect(requests).toEqual([]);
});

test('the request type is required before an API call', async function missingType() {
  expect(
    await paidRequestCli().run(['paid-request', '--requested-apps-amount', '10', '--json']),
  ).toBe(1);
  expect(errors.join('')).toContain('type');
  expect(requests).toEqual([]);
  expect(output).toEqual([]);
});

test('the previous positional type and generic amount flag are refused', async function oldSyntax() {
  for (const args of [
    ['paid-request', 'apps', '--requested-apps-amount', '10', '--json'],
    ['paid-request', '--type', 'apps', '--amount', '10', '--json'],
  ]) {
    expect(await paidRequestCli().run(args)).toBe(1);
  }
  expect(requests).toEqual([]);
  expect(output).toEqual([]);
});

test('unset options from another feature are allowed', async function unsetOption() {
  const options = {
    ...NO_RESOURCE_OPTIONS,
    type: 'apps' as const,
    'requested-apps-amount': ASKED_TOTAL,
    app: undefined,
    'custom-s3-bucket': undefined,
  };
  expect(await completePaidRequest({ options, interactive: false, api: paidRequestApi() })).toEqual(
    {
      requestType: 'apps',
      requestedAppsAmount: ASKED_TOTAL,
    },
  );
});

test.each(['bucket', 0, false])(
  'a supplied option from another feature is refused: %s',
  async function unrelatedOption(value) {
    const options = {
      ...NO_RESOURCE_OPTIONS,
      type: 'apps' as const,
      'requested-apps-amount': ASKED_TOTAL,
      app: undefined,
      'custom-s3-bucket': value,
    };
    await expect(
      completePaidRequest({ options, interactive: false, api: paidRequestApi() }),
    ).rejects.toThrow('Invalid options for --type apps');
    expect(requests).toEqual([]);
  },
);

test('a signed-out command fails before sending a request', async function signedOut() {
  expect(
    await paidRequestCli(false).run([
      'paid-request',
      '--type',
      'apps',
      '--requested-apps-amount',
      '10',
      '--json',
    ]),
  ).toBe(1);
  expect(errors).toEqual(['Not signed in. Run `nib login`.']);
  expect(requests).toEqual([]);
});

test('a refused request reports failure without a JSON success result', async function refused() {
  responseStatus = SERVICE_UNAVAILABLE_STATUS;
  expect(
    await paidRequestCli().run([
      'paid-request',
      '--type',
      'apps',
      '--requested-apps-amount',
      '10',
      '--json',
    ]),
  ).toBe(1);
  expect(errors.join('')).toContain('Please retry this request.');
  expect(output).toEqual([]);
});

test('a human sees confirmation of the requested total', async function confirmation() {
  expect(
    await paidRequestCli().run(['paid-request', '--type', 'apps', '--requested-apps-amount', '10']),
  ).toBe(0);
  expect(output.join('')).toContain('recorded your request for 10 apps in total');
});

test('a deployment refused at the app limit points to paid-request', async function quotaHint() {
  expect(
    await paidRequestCli().run(['run', 'https://example.test/server', '--json', '--detach']),
  ).toBe(1);
  expect(errors.join('')).toContain('Paid apps are coming. How many apps do you need?');
  expect(errors.join('')).toContain('nib paid-request --type apps');
  expect(output).toEqual([]);
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe(`${API_URL}/api/apps`);
});

test.each(
  APP_REQUEST_TYPES.flatMap((requestType) => [NAME, SLUG].map((app) => ({ requestType, app }))),
)(
  '$requestType requests resolve --app $app and save only its app ID',
  async ({ requestType, app }) => {
    expect(
      await paidRequestCli().run(['paid-request', '--type', requestType, '--app', app, '--json']),
    ).toBe(0);
    expect(errors).toEqual([]);
    expect(output).toEqual([`${JSON.stringify({ requestType, appId: APP_ID })}\n`]);
    expect(requests).toEqual([
      { url: `${API_URL}/api/apps`, method: 'GET', authorization: `Bearer ${TOKEN}`, body: null },
      {
        url: `${API_URL}/api/paid-requests/${requestType}`,
        method: 'PUT',
        authorization: `Bearer ${TOKEN}`,
        body: { appId: APP_ID },
      },
    ]);
  },
);

test.each(APP_REQUEST_TYPES)(
  '%s requests in scripts require --app without prompting or calling the API',
  async (requestType) => {
    const ask = spyOn(prompts, 'select').mockResolvedValue(APP_ID);
    expect(await paidRequestCli().run(['paid-request', '--type', requestType, '--json'])).toBe(1);
    expect(errors.join('')).toContain('--app');
    expect(ask).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
    expect(output).toEqual([]);
  },
);

test.each(APP_REQUEST_TYPES)(
  'a terminal can choose an app and cancel the %s request',
  async (requestType) => {
    const ask = spyOn(prompts, 'select').mockResolvedValue(APP_ID);
    const options = {
      ...NO_RESOURCE_OPTIONS,
      type: requestType,
      app: undefined,
      'requested-apps-amount': undefined,
    };
    expect(
      await completePaidRequest({ options, interactive: true, api: paidRequestApi() }),
    ).toEqual({
      requestType,
      appId: APP_ID,
    });
    expect(ask.mock.calls[0]?.[0]).toMatchObject({
      message: 'Which app?',
      options: [{ value: APP_ID, label: NAME, hint: SLUG }],
    });
    const cancellation = Symbol('cancel');
    spyOn(prompts, 'isCancel').mockImplementation((value) => value === cancellation);
    ask.mockResolvedValue(cancellation);
    await expect(
      completePaidRequest({ options, interactive: true, api: paidRequestApi() }),
    ).rejects.toThrow('Cancelled.');
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
  },
);

test.each([
  { args: ['--type', 'apps', '--app', NAME] },
  { args: ['--type', 'apps', '--app', NAME, '--requested-apps-amount', '10'] },
  ...APP_REQUEST_TYPES.map((type) => ({
    args: ['--type', type, '--app', NAME, '--requested-apps-amount', '10'],
  })),
])(
  'flags for another request type are refused before prompting or API calls: $args',
  async ({ args }) => {
    const ask = spyOn(prompts, 'text').mockResolvedValue(String(ASKED_TOTAL));
    expect(await paidRequestCli().run(['paid-request', ...args, '--json'])).toBe(1);
    expect(errors.join('')).toContain('Invalid options for --type');
    expect(ask).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
    expect(output).toEqual([]);
  },
);

test.each(APP_REQUEST_TYPES)('unknown apps cannot submit %s requests', async (requestType) => {
  expect(
    await paidRequestCli().run([
      'paid-request',
      '--type',
      requestType,
      '--app',
      'missing',
      '--json',
    ]),
  ).toBe(1);
  expect(errors.join('')).toContain('No app named missing');
  expect(requests).toHaveLength(1);
  expect(requests[0]?.method).toBe('GET');
  expect(output).toEqual([]);
});

test.each(APP_REQUEST_TYPES)(
  '%s requests require sign-in before listing apps or submitting',
  async (requestType) => {
    expect(
      await paidRequestCli(false).run([
        'paid-request',
        '--type',
        requestType,
        '--app',
        NAME,
        '--json',
      ]),
    ).toBe(1);
    expect(errors).toEqual(['Not signed in. Run `nib login`.']);
    expect(requests).toEqual([]);
  },
);

test.each(APP_REQUEST_TYPES)(
  'a failed %s request does not emit a JSON success result',
  async (requestType) => {
    responseStatus = SERVICE_UNAVAILABLE_STATUS;
    expect(
      await paidRequestCli().run(['paid-request', '--type', requestType, '--app', NAME, '--json']),
    ).toBe(1);
    expect(errors.join('')).toContain('Please retry this request.');
    expect(requests).toHaveLength(2);
    expect(output).toEqual([]);
  },
);

test('the bucket confirmation describes a feature request without enabling or charging', async () => {
  expect(
    await paidRequestCli().run(['paid-request', '--type', 'custom-bucket', '--app', NAME]),
  ).toBe(0);
  expect(output.join('')).toContain('recorded your request to use your own S3-compatible bucket');
  expect(output.join('')).toContain(APP_ID);
  expect(output.join('')).toContain('does not enable the feature or charge you');
});

test('the always-on confirmation names the app without enabling the feature or charging', async () => {
  expect(await paidRequestCli().run(['paid-request', '--type', 'always-on', '--app', NAME])).toBe(
    0,
  );
  expect(errors).toEqual([]);
  expect(output.join('')).toContain(`recorded your request to keep app ${APP_ID} always on`);
  expect(output.join('')).toContain('does not enable the feature or charge you');
});

test('paid-request help lists app feature requests and the app selector', async () => {
  expect(await paidRequestCli(false).run(['paid-request', '--help'])).toBe(0);
  for (const requestType of APP_REQUEST_TYPES) {
    expect(output.join('')).toContain(requestType);
  }
  expect(output.join('')).toContain('--app');
  expect(requests).toEqual([]);
});

test('the resources confirmation names the app and the requested resources', async () => {
  expect(
    await paidRequestCli().run([
      'paid-request',
      '--type',
      'resources',
      '--app',
      NAME,
      '--requested-vcpu-count',
      '2',
      '--requested-memory-mib',
      '512',
      '--requested-volume-gib',
      '16',
    ]),
  ).toBe(0);
  expect(errors).toEqual([]);
  expect(output.join('')).toContain(
    `2 vCPUs, 512 MiB RAM, and 16 GiB volume in total for app ${APP_ID}`,
  );
  expect(output.join('')).toContain('does not resize the app or charge you');
});

test.each([NAME, SLUG])(
  'resources requests preserve all amounts and resolve app %s',
  async (app) => {
    expect(
      await paidRequestCli().run([
        'paid-request',
        '--type',
        'resources',
        '--app',
        app,
        '--requested-vcpu-count',
        '2',
        '--requested-memory-mib',
        '512',
        '--requested-volume-gib',
        '16',
        '--json',
      ]),
    ).toBe(0);
    expect(errors).toEqual([]);
    expect(JSON.parse(output.join(''))).toEqual({
      requestType: 'resources',
      appId: APP_ID,
      ...RESOURCE_AMOUNTS,
    });
    expect(requests.at(-1)).toEqual({
      url: `${API_URL}/api/paid-requests/resources`,
      method: 'PUT',
      authorization: `Bearer ${TOKEN}`,
      body: { appId: APP_ID, ...RESOURCE_AMOUNTS },
    });
  },
);

test('a RAM-only request retains the current 1 vCPU and volume allocation', async () => {
  expect(
    await paidRequestCli().run([
      'paid-request',
      '--type',
      'resources',
      '--app',
      NAME,
      '--requested-memory-mib',
      '512',
      '--json',
    ]),
  ).toBe(0);
  expect(JSON.parse(output.join(''))).toEqual({
    requestType: 'resources',
    appId: APP_ID,
    requestedVcpuCount: CURRENT_APP_CONFIG.resources.vcpuCount,
    requestedMemoryMib: 512,
    requestedVolumeGib: 8,
  });
});

test('omitted totals use the selected app’s configured sizes rather than platform defaults', async () => {
  appConfig = {
    resources: { vcpuCount: 2, memoryMib: 768 },
    volumeSizeBytes: 25_769_803_776,
  };
  expect(
    await paidRequestCli().run([
      'paid-request',
      '--type',
      'resources',
      '--app',
      NAME,
      '--requested-memory-mib',
      '1024',
      '--json',
    ]),
  ).toBe(0);
  expect(JSON.parse(output.join(''))).toEqual({
    requestType: 'resources',
    appId: APP_ID,
    requestedVcpuCount: appConfig.resources.vcpuCount,
    requestedMemoryMib: 1_024,
    requestedVolumeGib: 24,
  });
});

test.each(['requested-vcpu-count', 'requested-memory-mib', 'requested-volume-gib'])(
  'invalid --%s values are refused before any API call',
  async (flag) => {
    for (const value of ['0', '-1', '1.5', 'NaN', String(MAX_PAID_RESOURCE_AMOUNT + 1)]) {
      expect(
        await paidRequestCli().run([
          'paid-request',
          '--type',
          'resources',
          '--app',
          NAME,
          `--${flag}`,
          value,
          '--json',
        ]),
      ).toBe(1);
    }
    expect(requests).toEqual([]);
    expect(output).toEqual([]);
  },
);

test('scripts require a requested total without prompting or submitting', async () => {
  const ask = spyOn(prompts, 'text').mockResolvedValue('1');
  for (const flags of [[], ['--requested-memory-mib', '0']]) {
    expect(
      await paidRequestCli().run([
        'paid-request',
        '--type',
        'resources',
        '--app',
        NAME,
        ...flags,
        '--json',
      ]),
    ).toBe(1);
  }
  expect(errors.join('')).toContain('total you need');
  expect(ask).not.toHaveBeenCalled();
  expect(requests.every((request) => request.method === 'GET')).toBe(true);
  expect(output).toEqual([]);
});

test('a terminal can enter each resource amount and cancel before submitting', async () => {
  const ask = spyOn(prompts, 'text')
    .mockResolvedValueOnce('2')
    .mockResolvedValueOnce('512')
    .mockResolvedValueOnce('16');
  const options = {
    ...NO_RESOURCE_OPTIONS,
    type: 'resources' as const,
    app: NAME,
    'requested-apps-amount': undefined,
  };
  expect(await completePaidRequest({ options, interactive: true, api: paidRequestApi() })).toEqual({
    requestType: 'resources',
    appId: APP_ID,
    ...RESOURCE_AMOUNTS,
  });
  expect(ask.mock.calls.map((call) => call[0].message)).toEqual([
    'How many vCPUs do you need in total?',
    'How much RAM do you need in total (MiB)?',
    'How much volume do you need in total (GiB)?',
  ]);
  expect(ask.mock.calls.map((call) => call[0].defaultValue)).toEqual(['1', '256', '8']);
  const cancellation = Symbol('cancel');
  spyOn(prompts, 'isCancel').mockImplementation((value) => value === cancellation);
  ask.mockResolvedValue(cancellation);
  await expect(
    completePaidRequest({ options, interactive: true, api: paidRequestApi() }),
  ).rejects.toThrow('Cancelled.');
  expect(requests.every((request) => request.method === 'GET')).toBe(true);
});

test.each(['apps', ...APP_REQUEST_TYPES])(
  'resource amount flags cannot be used for %s requests',
  async (type) => {
    expect(
      await paidRequestCli().run([
        'paid-request',
        '--type',
        type,
        '--requested-memory-mib',
        '512',
        '--json',
      ]),
    ).toBe(1);
    expect(errors.join('')).toContain('Invalid options for --type');
    expect(requests).toEqual([]);
  },
);

test('resources requests require sign-in and an app before submitting', async () => {
  const flags = ['paid-request', '--type', 'resources', '--requested-memory-mib', '512', '--json'];
  expect(await paidRequestCli(false).run([...flags, '--app', NAME])).toBe(1);
  expect(errors.join('')).toContain('Not signed in');
  expect(await paidRequestCli().run(flags)).toBe(1);
  expect(errors.join('')).toContain('--app');
  expect(requests).toEqual([]);
});

test('failed resources requests emit no JSON success', async () => {
  responseStatus = SERVICE_UNAVAILABLE_STATUS;
  expect(
    await paidRequestCli().run([
      'paid-request',
      '--type',
      'resources',
      '--app',
      NAME,
      '--requested-memory-mib',
      '512',
      '--json',
    ]),
  ).toBe(1);
  expect(errors.join('')).toContain('Please retry this request');
  expect(output).toEqual([]);
});
