import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { authClient } from '#lib/auth.ts';
import { DEVICE_CODE_QUERY_KEY } from '#queries/device.ts';

export type DeviceDecision = 'approve' | 'deny';

/**
 * Both answers are the same request with a different verb, and both end the code's life — so the
 * cached status is dropped either way rather than left saying `pending` next to a decision the
 * owner has already made.
 */
export function useDeviceDecision(
  userCode: string,
): UseMutationResult<void, Error, DeviceDecision> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (decision: DeviceDecision) => {
      const { error } = await authClient.device[decision]({ userCode });
      if (error) {
        throw new Error(error.error_description ?? 'That decision could not be recorded.');
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [DEVICE_CODE_QUERY_KEY, userCode] }),
  });
}
