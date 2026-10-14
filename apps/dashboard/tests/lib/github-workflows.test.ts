import { afterAll, afterEach, expect, spyOn, test } from 'bun:test';
import { createPublicApiClient } from '@repo/api-client/public';
import type { GitHubWorkflow } from '@repo/app-operations';
import { githubWorkflowExample } from '#lib/github-workflow-example.ts';
import { saveGitHubWorkflow } from '#lib/github-workflows.ts';

const appId = 'app-id';
const api = createPublicApiClient({ baseUrl: 'https://api.example.com' });
const workflow: GitHubWorkflow = {
  id: 'workflow-id',
  repository: 'owner/repository',
  workflow: 'deploy.yml',
  branch: 'main',
  environment: null,
};
const fetchSpy = spyOn(globalThis, 'fetch');

afterEach(() => fetchSpy.mockReset());
afterAll(() => fetchSpy.mockRestore());

function reply({ status, body }: { status: number; body: unknown }) {
  fetchSpy.mockResolvedValue(Response.json(body, { status }));
}

test('saving normalizes form fields and sends a blank environment as unrestricted', async () => {
  reply({ status: 201, body: workflow });
  expect(
    await saveGitHubWorkflow({
      api,
      appId,
      workflowId: undefined,
      fields: {
        repository: ' owner/repository ',
        workflow: ' deploy.yml ',
        branch: ' main ',
        environment: '  ',
      },
    }),
  ).toEqual(workflow);
  expect(fetchSpy.mock.calls).toHaveLength(1);
  const request = fetchSpy.mock.calls[0]?.[1];
  expect(JSON.parse(String(request?.body))).toEqual({
    repository: workflow.repository,
    workflow: workflow.workflow,
    branch: workflow.branch,
    environment: null,
  });
});

test('saving retains the known workflow id and trims the environment restriction', async () => {
  reply({ status: 200, body: { ...workflow, environment: 'production' } });
  await saveGitHubWorkflow({
    api,
    appId,
    workflowId: workflow.id,
    fields: { ...workflow, environment: ' production ' },
  });
  expect(fetchSpy.mock.calls).toHaveLength(1);
  const [url, request] = fetchSpy.mock.calls[0] ?? [];
  expect(url).toBe('https://api.example.com/api/apps/app-id/trusted-workflows/workflow-id');
  expect(JSON.parse(String(request?.body)).environment).toBe('production');
});

test('the example grants OIDC permission and deploys this app using the saved branch', () => {
  const example = githubWorkflowExample({
    appId,
    workflow: { ...workflow, branch: 'release/v1' },
    binaryName: 'uploaded-binary',
  });
  expect(Bun.YAML.parse(example)).toMatchObject({
    on: { push: { branches: ['release/v1'] } },
    permissions: { contents: 'read', 'id-token': 'write' },
    jobs: {
      deploy: {
        steps: [
          { uses: 'actions/checkout@v7' },
          { uses: 'nibrunhq/setup-cli@v1' },
          { name: 'Build binary', run: './build.sh' },
          {
            name: 'Deploy',
            run: 'nib run ./uploaded-binary --github-trusted-oidc --app-id app-id',
          },
        ],
      },
    },
  });
  expect(example).not.toContain('environment:');
});

test('an environment containing quotes and YAML syntax remains one quoted value', () => {
  const environment = 'production: "blue" # deployment';
  const example = githubWorkflowExample({
    appId,
    workflow: { ...workflow, environment },
    binaryName: 'server',
  });
  expect(example).toContain(`    environment: ${JSON.stringify(environment)}\n`);
  expect(Bun.YAML.parse(example)).toMatchObject({ jobs: { deploy: { environment } } });
});

test.each([
  'server',
  'server with spaces',
  "it's-the-binary",
  'binary"$NIB_QUOTE_TEST`printf substituted`$(printf expanded)',
])('the copied workflow passes the actual filename %s literally to nib', (binaryName) => {
  const example = githubWorkflowExample({ appId, workflow, binaryName });
  const parsed = Bun.YAML.parse(example) as {
    jobs: { deploy: { steps: { name: string | undefined; run: string | undefined }[] } };
  };
  const command = parsed.jobs.deploy.steps.find((step) => step.name === 'Deploy')?.run;
  expect(command).toBeDefined();
  const argv = shellArguments(String(command));
  expect(argv[0]).toBe('run');
  expect(argv.slice(2)).toEqual(['--github-trusted-oidc', '--app-id', appId, '']);
  expect(shellArguments(`nib ${argv[1]}`)).toEqual([`./${binaryName}`, '']);
});

function shellArguments(command: string): string[] {
  const result = Bun.spawnSync(['sh', '-c', `nib() { printf '%s\\0' "$@"; }\n${command}`], {
    env: { NIB_QUOTE_TEST: 'expanded' },
  });
  expect(result.exitCode).toBe(0);
  return result.stdout.toString().split('\0');
}
