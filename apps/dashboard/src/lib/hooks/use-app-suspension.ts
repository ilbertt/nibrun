import type { OwnedAppState } from '@repo/api-client/models';
import { type AppOperation, resumeApp, suspendApp } from '@repo/app-operations';
import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '#lib/api.ts';
import { useAppAnalytics } from '#lib/hooks/use-app-analytics.ts';

export type SuspendedApp = Awaited<ReturnType<typeof suspendApp>>;

/**
 * Keyed by the state being asked for rather than by a verb, so a state an owner can put an app in
 * and no operation here reaches is a type error rather than a button that does nothing.
 */
const OPERATION: Record<OwnedAppState, { run: typeof suspendApp; action: AppOperation }> = {
  suspended: { run: suspendApp, action: 'suspend' },
  active: { run: resumeApp, action: 'resume' },
};

export function useAppSuspension(
  appId: string,
): UseMutationResult<SuspendedApp, Error, OwnedAppState> {
  const queryClient = useQueryClient();
  const analytics = useAppAnalytics(appId);

  return useMutation({
    mutationFn: (state: OwnedAppState) =>
      analytics.run({
        action: OPERATION[state].action,
        task: () => OPERATION[state].run({ api, appId }),
      }),
    // Both, because the answer is made of both: `['apps']` is a prefix that takes the app's own
    // row with it, and the release beside it is what says whether the host has caught up yet.
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['apps'] }),
        queryClient.invalidateQueries({ queryKey: ['deployments', appId] }),
      ]);
    },
  });
}
