import { useQuery } from '@tanstack/react-query';
import { deviceCodeQueryOptions } from '#queries/device.ts';

export type DeviceCodeState =
  | { status: 'checking' | 'waiting'; reason?: undefined }
  | { status: 'refused'; reason: string };

/**
 * Reading the code is also what claims it for the signed-in owner, so `waiting` means the api has
 * already accepted this browser as the one entitled to answer — not merely that a code was typed.
 */
export function useDeviceCode(userCode: string): DeviceCodeState {
  const { isPending, isError, error } = useQuery(deviceCodeQueryOptions(userCode));

  if (isPending) {
    return { status: 'checking' };
  }
  if (isError) {
    return { status: 'refused', reason: error.message };
  }
  return { status: 'waiting' };
}
