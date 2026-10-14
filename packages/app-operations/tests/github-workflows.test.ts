import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import { createPublicApiClient } from '@repo/api-client/public';
import { ApiError } from '@repo/api-client/unwrap';
import {
  type GitHubWorkflow,
  type GitHubWorkflowInput,
  readGitHubWorkflow,
  removeGitHubWorkflow,
  setGitHubWorkflow,
} from '#github-workflows.ts';

const appId = 'app-id';
const NO_CONTENT = 204;
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const INTERNAL_SERVER_ERROR = 500;
const api = createPublicApiClient({ baseUrl: 'https://api.example.com' });
const workflowInput: GitHubWorkflowInput = {
  repository: 'owner/repository',
  workflow: 'deploy.yml',
  branch: 'main',
  environment: null,
};
const workflow: GitHubWorkflow = { id: 'workflow-id', ...workflowInput };
const fetchSpy = spyOn(globalThis, 'fetch');

afterEach(() => fetchSpy.mockReset());
afterAll(() => fetchSpy.mockRestore());

function reply({ status, body }: { status: number; body: unknown }) {
  fetchSpy.mockResolvedValue(
    status === NO_CONTENT ? new Response(null, { status }) : Response.json(body, { status }),
  );
}

describe('reading the trusted GitHub workflow', () => {
  test('only a missing workflow is treated as unconfigured', async () => {
    reply({ status: 404, body: { error: 'Not Found' } });
    expect(await readGitHubWorkflow({ api, appId })).toBeNull();
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'https://api.example.com/api/apps/app-id/trusted-workflows',
    );
  });

  test.each([UNAUTHORIZED, FORBIDDEN, INTERNAL_SERVER_ERROR])(
    'a %s refusal stays an error',
    async (status) => {
      reply({ status, body: { error: 'Refused' } });
      await expect(readGitHubWorkflow({ api, appId })).rejects.toBeInstanceOf(ApiError);
    },
  );

  test('returns the saved workflow and its id', async () => {
    reply({ status: 200, body: workflow });
    expect(await readGitHubWorkflow({ api, appId })).toEqual(workflow);
  });

  test('a network failure stays an error', async () => {
    fetchSpy.mockRejectedValue(new Error('Network unavailable'));
    await expect(readGitHubWorkflow({ api, appId })).rejects.toThrow('Network unavailable');
  });
});

describe('changing trust', () => {
  test('creates with one POST and preserves the complete input', async () => {
    reply({ status: 201, body: workflow });
    expect(
      await setGitHubWorkflow({ api, appId, workflowId: undefined, workflow: workflowInput }),
    ).toEqual(workflow);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, request] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('https://api.example.com/api/apps/app-id/trusted-workflows');
    expect(request?.method).toBe('POST');
    expect(JSON.parse(String(request?.body))).toEqual(workflowInput);
  });

  test('updates the supplied id with one PUT and preserves its environment restriction', async () => {
    const restrictedInput = { ...workflowInput, environment: 'production' };
    const restrictedWorkflow = { ...workflow, environment: restrictedInput.environment };
    reply({ status: 200, body: restrictedWorkflow });
    expect(
      await setGitHubWorkflow({
        api,
        appId,
        workflowId: workflow.id,
        workflow: restrictedInput,
      }),
    ).toEqual(restrictedWorkflow);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, request] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('https://api.example.com/api/apps/app-id/trusted-workflows/workflow-id');
    expect(request?.method).toBe('PUT');
    expect(JSON.parse(String(request?.body))).toEqual(restrictedInput);
  });

  test('removes the supplied id with one DELETE', async () => {
    reply({ status: NO_CONTENT, body: undefined });
    await removeGitHubWorkflow({ api, appId, workflowId: workflow.id });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, request] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('https://api.example.com/api/apps/app-id/trusted-workflows/workflow-id');
    expect(request?.method).toBe('DELETE');
  });

  test('creation and update refusals stay errors', async () => {
    reply({ status: 409, body: { error: 'Already configured' } });
    await expect(
      setGitHubWorkflow({ api, appId, workflowId: undefined, workflow: workflowInput }),
    ).rejects.toThrow('Already configured');
    reply({ status: FORBIDDEN, body: { error: 'Forbidden' } });
    await expect(
      setGitHubWorkflow({ api, appId, workflowId: workflow.id, workflow: workflowInput }),
    ).rejects.toThrow('Forbidden');
  });

  test('a removal refusal stays an error', async () => {
    reply({ status: FORBIDDEN, body: { error: 'Forbidden' } });
    await expect(removeGitHubWorkflow({ api, appId, workflowId: workflow.id })).rejects.toThrow(
      'Forbidden',
    );
  });
});
