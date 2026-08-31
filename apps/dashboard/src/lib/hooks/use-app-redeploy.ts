import { useApp } from '#lib/hooks/use-app.ts';
import { useFailureToast } from '#lib/hooks/use-failure-toast.ts';
import { isReleasing, useRunApp } from '#lib/hooks/use-run-app.ts';

export type AppRedeploy = {
  readonly releasing: boolean;
  /** Absent until the app has been read: there is no config to release again before there is one. */
  readonly start: (() => void) | undefined;
};

/**
 * The app released again on exactly what it already has — the binary its newest release pinned,
 * and its arguments and port restated rather than edited.
 *
 * The environment is left unsaid, which is what keeps it: a browser cannot read a secret back to
 * restate it, so a release that named the variables it wanted would be one that dropped every
 * value it could not see.
 */
export function useAppRedeploy(appId: string): AppRedeploy {
  const app = useApp(appId);
  const run = useRunApp({ onDeployed: undefined });
  useFailureToast(run.reason);

  const released = app.data;

  return {
    releasing: isReleasing(run.phase),
    start:
      released === undefined
        ? undefined
        : () =>
            run.start({
              app: released.slug,
              args: released.config.args,
              port: released.config.httpPort,
            }),
  };
}
