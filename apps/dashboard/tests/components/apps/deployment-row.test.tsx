import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeploymentRow } from '#components/apps/deployment-row.tsx';
import type { DeploymentSummary } from '#queries/deployments.ts';

function deployment(initiatedBy: DeploymentSummary['initiatedBy']): DeploymentSummary {
  return {
    id: '0199c0de-0000-7000-8000-000000000003',
    appId: '0199c0de-0000-7000-8000-000000000001',
    artifactId: '0199c0de-0000-7000-8000-000000000002',
    initiatedBy,
    state: 'running',
    createdAt: '2026-11-10T09:00:00.000Z',
    restartCount: 0,
    config: {
      args: [],
      volumeSizeBytes: 8_589_934_592,
      environment: {},
      httpPort: 3000,
      hasExtraPublicPort: false,
      resources: { vcpuCount: 1, memoryMib: 256 },
      healthCheck: {
        intervalMs: 1000,
        timeoutMs: 1000,
        gracePeriodMs: 30000,
        healthyThreshold: 1,
        unhealthyThreshold: 3,
      },
      restartPolicy: {
        maxRestarts: 5,
        initialBackoffMs: 500,
        maxBackoffMs: 5000,
        backoffFactor: 2,
        resetAfterMs: 60000,
      },
    },
  };
}

test.each([
  { initiatedBy: 'system.host-migration' as const, label: 'System · Host migration' },
  { initiatedBy: 'system.storage-migration' as const, label: 'System · Storage migration' },
])(
  'system deployment rows identify their initiator without an artifact response: $initiatedBy',
  (input) => {
    const markup = renderToStaticMarkup(
      <table>
        <tbody>
          <DeploymentRow deployment={deployment(input.initiatedBy)} artifact={undefined} />
        </tbody>
      </table>,
    );
    expect(markup).toContain(input.label);
    expect(markup).toContain(`aria-label="${input.label}"`);
  },
);

test('user deployments do not receive a system label', () => {
  const markup = renderToStaticMarkup(
    <table>
      <tbody>
        <DeploymentRow deployment={deployment('owner')} artifact={undefined} />
      </tbody>
    </table>,
  );
  expect(markup).not.toContain('System');
});
