import { afterEach, expect, test } from 'bun:test';
import { ensurePublicDashboard } from '#shared/grafana.ts';

const token = '0123456789abcdef0123456789abcdef';
const OK = 200;
const NOT_FOUND = 404;
let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(function stopServer() {
  server?.stop(true);
});

function bootstrapOptions() {
  return {
    url: server!.url.toString(),
    password: 'private-bootstrap-password',
    publicDashboardToken: token,
  };
}

test('creates sharing only for the aggregate dashboard with fixed time selection and no annotations', async function createsAggregateShare() {
  let created: unknown;
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      expect(new URL(request.url).pathname).toBe(
        '/api/dashboards/uid/nibrunner-public/public-dashboards/',
      );
      if (request.method === 'GET') {
        return new Response(null, { status: NOT_FOUND });
      }
      created = await request.json();
      return Response.json({}, { status: OK });
    },
  });
  await ensurePublicDashboard(bootstrapOptions());
  expect(created).toEqual({
    accessToken: token,
    isEnabled: true,
    timeSelectionEnabled: false,
    annotationsEnabled: false,
    share: 'public',
  });
});

test('reuses the existing public link instead of creating another share on redeploy', async function reusesPublicShare() {
  const mutations: string[] = [];
  server = Bun.serve({
    port: 0,
    fetch(request) {
      if (request.method === 'GET') {
        return Response.json({ uid: 'existing-share', accessToken: token });
      }
      mutations.push(`${request.method} ${new URL(request.url).pathname}`);
      return Response.json({});
    },
  });
  await ensurePublicDashboard(bootstrapOptions());
  expect(mutations).toEqual([
    'PATCH /api/dashboards/uid/nibrunner-public/public-dashboards/existing-share',
  ]);
});

test('refuses a mismatched public link without altering the existing share', async function preservesUnexpectedShare() {
  const mutations: string[] = [];
  server = Bun.serve({
    port: 0,
    fetch(request) {
      mutations.push(request.method);
      return Response.json({ uid: 'existing-share', accessToken: 'different-token' });
    },
  });
  await expect(ensurePublicDashboard(bootstrapOptions())).rejects.toThrow('differs');
  expect(mutations).toEqual(['GET']);
});

test('fails on authentication errors without attempting to create a share', async function refusesUnauthorizedBootstrap() {
  const UNAUTHORIZED = 401;
  const methods: string[] = [];
  server = Bun.serve({
    port: 0,
    fetch(request) {
      methods.push(request.method);
      return new Response(null, { status: UNAUTHORIZED });
    },
  });
  await expect(ensurePublicDashboard(bootstrapOptions())).rejects.toThrow('401');
  expect(methods).toEqual(['GET']);
});
