import { resumeApp, suspendApp } from '@repo/app-operations';
import type { OwnedAppState } from '@repo/protocol';
import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '#lib/api.ts';

export type SuspendedApp = Awaited<ReturnType<typeof suspendApp>>;

/**
 * Keyed by the state being asked for rather than by a verb, so a state an owner can put an app in
 * and no operation here reaches is a type error rather than a button that does nothing.
 */
const OPERATION: Record<OwnedAppState, typeof suspendApp> = {
  suspended: suspendApp,
  active: resumeApp,
};

export function useAppSuspension(
  appId: string,
): UseMutationResult<SuspendedApp, Error, OwnedAppState> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (state: OwnedAppState) => OPERATION[state]({ api, appId }),
    // A prefix, so this takes the app's own row with it: `['apps', appId]` is what the badge and
    // this button read the state from, and it is the state that just moved.
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['apps'] });
    },
  });
}
