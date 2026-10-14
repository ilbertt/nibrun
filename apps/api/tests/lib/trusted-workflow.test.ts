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
    { environment: '' },
    { environment: '   ' },
  ])('rejects invalid configuration %j', (override) => {
    expect(Value.Check(TrustedWorkflowSchema, trustedWorkflow(override))).toBe(false);
  });
});

describe('only the configured repository, workflow file, and environment are trusted', () => {
  test.each(['refs/heads/main', 'refs/heads/release/v1', 'refs/tags/v2026.10.4'])(
    'allows pushes and manual runs from %s',
    (ref) => {
      for (const event_name of ['push', 'workflow_dispatch']) {
        expect(
          matchesTrustedWorkflow({
            workflow: trustedWorkflow(),
            claims: claims({
              event_name,
              ref,
              workflow_ref: `acme/backend/.github/workflows/deploy.yml@${ref}`,
            }),
          }),
        ).toBe(true);
      }
    },
  );

  test.each([
    { repository: 'stranger/backend' },
    { ref: 'refs/heads/feature' },
    { ref: 'refs/tags/main' },
    { workflow_ref: 'acme/backend/.github/workflows/other.yml@refs/heads/main' },
    { workflow_ref: 'stranger/backend/.github/workflows/deploy.yml@refs/heads/main' },
    { workflow_ref: 'acme/backend/.github/workflows/deploy.yml-extra@refs/heads/main' },
    { workflow_ref: 'acme/backend/.github/workflows/deploy.yml/subpath@refs/heads/main' },
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
