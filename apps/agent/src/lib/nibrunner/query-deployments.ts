import type { HostReportedState } from '@repo/protocol';
import type { HostDesiredState } from '#lib/nibrunner/desired.gen.ts';

export function nibrunnerQueryDeployments({
  desired,
  report,
}: {
  desired: HostDesiredState;
  report: HostReportedState;
}) {
  if (report.state !== 'ready' && report.state !== 'draining') {
    return [];
  }
  return desired.instances.flatMap(function current(wanted) {
    const observed = report.instances.find(
      (instance) =>
        instance.appId === wanted.appId && instance.deploymentId === wanted.deploymentId,
    );
    return observed === undefined
      ? []
      : [
          {
            appId: observed.appId,
            deploymentId: observed.deploymentId,
            desiredState: wanted.desiredState,
          },
        ];
  });
}
