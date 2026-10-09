import { describe, expect, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { TrustedWorkflowSchema } from '#lib/api/trusted-workflow.ts';
import { matchesTrustedWorkflow } from '#lib/trusted-workflow.ts';
import { trustedWorkflow } from '#tests/support/trusted-workflows.ts';

type IdentityClaims = Parameters<typeof matchesTrustedWorkflow>[0]['claims'];

function claims(overrides: Partial<IdentityClaims> = {}): IdentityClaims {
  return {
    repository: 'acme/backend',
    workflow_ref: 'acme/backend/.github/workflows/deploy.yml@refs/heads/main',
    ref: 'refs/heads/main',
    event_name: 'push',
    ...overrides,
  };
}

describe('a trust configuration names an exact GitHub workflow', () => {
  test.each([
    { repository: 'https://github.com/acme/backend' },
    { repository: 'acme/backend/other' },
    { workflow: '../deploy.yml' },
    { workflow: '.github/workflows/deploy.yml' },
    { workflow: 'deploy' },
    { branch: '' },
    { branch: 'release..next' },
    { branch: '/main' },
    { branch: 'main/' },
    { branch: 'refs/heads/main.lock' },
    { branch: 'release//main' },
    { branch: '@' },
    { branch: '.hidden' },
    { branch: 'release/.hidden' },
    { branch: 'main@{1}' },
    { branch: 'main branch' },
    { branch: 'main\u0001next' },
    { branch: 'main\u007fnext' },
    { branch: 'main\\next' },
    { environment: '' },
    { environment: '   ' },
  ])('rejects invalid configuration %j', (override) => {
    expect(Value.Check(TrustedWorkflowSchema, trustedWorkflow(override))).toBe(false);
  });

  test.each(['main', 'release/v1.2', 'release-candidate', 'features/login'])(
    'accepts branch %s',
    (branch) => {
      expect(Value.Check(TrustedWorkflowSchema, trustedWorkflow({ branch }))).toBe(true);
    },
  );
});

describe('only the configured production context is trusted', () => {
  test('allows pushes and manual runs on the configured branch', () => {
    for (const event_name of ['push', 'workflow_dispatch']) {
      expect(
        matchesTrustedWorkflow({ workflow: trustedWorkflow(), claims: claims({ event_name }) }),
      ).toBe(true);
    }
  });

  test.each([
    { repository: 'stranger/backend' },
    { ref: 'refs/heads/feature' },
    { ref: 'refs/tags/main' },
    { workflow_ref: 'acme/backend/.github/workflows/other.yml@refs/heads/main' },
    { workflow_ref: 'acme/backend/.github/workflows/deploy.yml@refs/heads/feature' },
    { workflow_ref: 'acme/backend/.github/workflows/Deploy.yml@refs/heads/main' },
    { event_name: 'pull_request' },
    { event_name: 'pull_request_target' },
    { event_name: 'workflow_run' },
    { event_name: 'workflow_dispatch', ref: 'refs/heads/feature' },
  ])('refuses mismatched or unsafe identity %j', (override) => {
    expect(matchesTrustedWorkflow({ workflow: trustedWorkflow(), claims: claims(override) })).toBe(
      false,
    );
  });

  test('repository names are case-insensitive while workflow paths remain exact', () => {
    expect(
      matchesTrustedWorkflow({
        workflow: trustedWorkflow({ repository: 'ACME/Backend' }),
        claims: claims({
          repository: 'Acme/Backend',
          workflow_ref: 'Acme/Backend/.github/workflows/deploy.yml@refs/heads/main',
        }),
      }),
    ).toBe(true);
  });

  test('an environment is constrained only when configured', () => {
    const production = trustedWorkflow({ environment: 'production' });
    expect(matchesTrustedWorkflow({ workflow: production, claims: claims() })).toBe(false);
    expect(
      matchesTrustedWorkflow({ workflow: production, claims: claims({ environment: 'preview' }) }),
    ).toBe(false);
    expect(
      matchesTrustedWorkflow({
        workflow: production,
        claims: claims({ environment: 'production' }),
      }),
    ).toBe(true);
    expect(
      matchesTrustedWorkflow({
        workflow: trustedWorkflow(),
        claims: claims({ environment: 'production' }),
      }),
    ).toBe(true);
  });
});
