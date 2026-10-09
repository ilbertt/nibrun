import { Value } from '@sinclair/typebox/value';
import { TrustedWorkflowIdSchema } from '#lib/api/identifiers.ts';
import type { TrustedWorkflow, TrustedWorkflowResource } from '#lib/api/trusted-workflow.ts';

export function trustedWorkflow(overrides: Partial<TrustedWorkflow> = {}): TrustedWorkflow {
  return {
    repository: 'acme/backend',
    workflow: 'deploy.yml',
    branch: 'main',
    environment: null,
    ...overrides,
  };
}

export function trustedWorkflowResource(
  overrides: Partial<TrustedWorkflowResource> = {},
): TrustedWorkflowResource {
  return {
    id: Value.Parse(TrustedWorkflowIdSchema, 'workflow-1'),
    ...trustedWorkflow(),
    ...overrides,
  };
}
