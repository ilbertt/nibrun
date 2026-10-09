import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { StatusMap } from 'elysia';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { ORIGIN, routesUnder, send, sendJson } from '#tests/controllers/support/api.ts';
import { trustedWorkflow, trustedWorkflowResource } from '#tests/support/trusted-workflows.ts';

const { auth, TrustedWorkflowsServicePlugin } = await import('#services/plugins.ts');
const URL = `${ORIGIN}/api/apps/app-1/trusted-workflows`;
const RESOURCE_URL = `${URL}/workflow-1`;
const OWNER_ID = Value.Parse(OwnerIdSchema, 'workflow-owner');
const SESSION_LIFETIME_MS = 60_000;

function authenticate() {
  const now = new Date();
  spyOn(auth.api, 'getSession').mockResolvedValue({
    user: {
      id: OWNER_ID,
      name: 'Workflow owner',
      email: 'owner@example.test',
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
      isAnonymous: false,
      image: null,
    },
    session: {
      id: 'session-1',
      userId: OWNER_ID,
      token: 'session-token',
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
      ipAddress: null,
      userAgent: null,
    },
  });
}

afterEach(function restoreMocks() {
  mock.restore();
});

test('trusted workflow creation and identified updates are separate routes', () => {
  expect(routesUnder('/api/apps/:appId/trusted-workflows')).toEqual([
    { method: 'GET', path: '/api/apps/:appId/trusted-workflows' },
    { method: 'POST', path: '/api/apps/:appId/trusted-workflows' },
    { method: 'PUT', path: '/api/apps/:appId/trusted-workflows/:workflowId' },
    { method: 'DELETE', path: '/api/apps/:appId/trusted-workflows/:workflowId' },
  ]);
});

test('trusted workflows require an account session', async () => {
  for (const response of await Promise.all([
    send({ url: URL }),
    sendJson({ method: 'POST', url: URL, body: trustedWorkflow() }),
    sendJson({ method: 'PUT', url: RESOURCE_URL, body: trustedWorkflow() }),
    send({ method: 'DELETE', url: RESOURCE_URL }),
  ])) {
    expect(response.status).toBe(StatusMap.Unauthorized);
  }
});

test('workflow paths and invalid branch refs are refused on both creation and update', async () => {
  for (const override of [{ workflow: '../deploy.yml' }, { branch: 'main..next' }]) {
    for (const route of [
      { method: 'POST', url: URL },
      { method: 'PUT', url: RESOURCE_URL },
    ]) {
      expect((await sendJson({ ...route, body: trustedWorkflow(override) })).status).toBe(
        StatusMap['Bad Request'],
      );
    }
  }
});

test('creation returns 201 and the workflow ID used for updates and deletion', async () => {
  authenticate();
  const service = TrustedWorkflowsServicePlugin.decorator.trustedWorkflowsService;
  const created = trustedWorkflowResource();
  const create = spyOn(service, 'create').mockResolvedValue(created);
  const workflow = trustedWorkflow();
  const response = await sendJson({ method: 'POST', url: URL, body: workflow });
  expect(response.status).toBe(StatusMap.Created);
  expect(await response.json()).toEqual(created);
  const ownedApp = { appId: Value.Parse(AppIdSchema, 'app-1'), ownerId: OWNER_ID };
  expect(create).toHaveBeenCalledWith({ ...ownedApp, workflow });
  const replacement = trustedWorkflow({ branch: 'production' });
  const update = spyOn(service, 'update').mockResolvedValue({ ...created, ...replacement });
  const updated = await sendJson({ method: 'PUT', url: RESOURCE_URL, body: replacement });
  expect(updated.status).toBe(StatusMap.OK);
  expect(await updated.json()).toEqual({ ...created, ...replacement });
  expect(update).toHaveBeenCalledWith({
    ...ownedApp,
    workflowId: created.id,
    workflow: replacement,
  });
  const remove = spyOn(service, 'remove').mockResolvedValue(undefined);
  const deleted = await send({ method: 'DELETE', url: RESOURCE_URL });
  expect(deleted.status).toBe(StatusMap['No Content']);
  expect(await deleted.text()).toBe('');
  expect(remove).toHaveBeenCalledWith({ ...ownedApp, workflowId: created.id });
});
