import { type UseMutationResult, useMutation } from '@tanstack/react-query';
import { authClient } from '#lib/auth.ts';

export type DeviceDecision = 'approve' | 'deny';

/** Both answers are the same request with a different verb. */
export function useDeviceDecision(
  userCode: string,
): UseMutationResult<void, Error, DeviceDecision> {
  return useMutation({
    mutationFn: async (decision: DeviceDecision) => {
      const { error } = await authClient.device[decision]({ userCode });
      if (error) {
        throw new Error(error.error_description ?? 'That decision could not be recorded.');
      }
    },
  });
}
