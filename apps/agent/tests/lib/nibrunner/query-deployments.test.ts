import { expect, test } from 'bun:test';
import { nibrunnerQueryDeployments } from '#lib/nibrunner/query-deployments.ts';
import { decodeNibrunnerReport } from '#lib/nibrunner/reported-state.ts';
import { nibrunnerDocument } from '#lib/nibrunner/state-files.ts';
import { desiredInstance, desiredState } from '#tests/support/fixtures.ts';
import { nibrunnerReport } from '#tests/support/nibrunner.ts';
import { runScoped } from '#tests/support/run.ts';

test('query ownership includes suspended registrations and excludes unpublished or replaced deployments', async () => {
  const instance = desiredInstance({ desiredState: 'stopped' });
  const desired = nibrunnerDocument(desiredState({ instances: [instance] }));
  const report = await runScoped(decodeNibrunnerReport(nibrunnerReport()));
  expect(nibrunnerQueryDeployments({ desired, report })).toEqual([
    {
      appId: instance.appId,
      deploymentId: instance.deploymentId,
      desiredState: 'stopped',
    },
  ]);
  expect(
    nibrunnerQueryDeployments({ desired, report: { ...report, state: 'registering' } }),
  ).toEqual([]);
  expect(
    nibrunnerQueryDeployments({ desired, report: { ...report, state: 'unreachable' } }),
  ).toEqual([]);
  expect(nibrunnerQueryDeployments({ desired: { ...desired, instances: [] }, report })).toEqual([]);
});
