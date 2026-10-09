import type { TrustedWorkflow } from '#lib/api/trusted-workflow.ts';

export function trustedWorkflow(overrides: Partial<TrustedWorkflow> = {}): TrustedWorkflow {
  return {
    repository: 'acme/backend',
    workflow: 'deploy.yml',
    branch: 'main',
    environment: null,
    ...overrides,
  };
}
