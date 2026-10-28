import { unwrap } from '@repo/api-client/unwrap';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '#lib/api.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import {
  type PaidResourceAmounts,
  type PaidResourceValues,
  paidResourceAmounts,
} from '#lib/paid-resources-request.ts';

type PaidResourcesRequestForm = {
  values: PaidResourceValues;
  change: (input: { resource: keyof PaidResourceValues; value: string }) => void;
  submit: () => void;
  pending: boolean;
  submittable: boolean;
  savedAmounts: PaidResourceAmounts | undefined;
  error: string | undefined;
};

export function usePaidResourcesRequest(): PaidResourcesRequestForm {
  const appId = useAppId();
  const [values, setValues] = useState<PaidResourceValues>({
    additionalVcpuCount: '0',
    additionalMemoryMib: '0',
    additionalVolumeGib: '0',
  });
  const amounts = paidResourceAmounts(values);
  const save = useMutation({
    mutationFn: async function savePaidResourcesRequest(additional: PaidResourceAmounts) {
      return unwrap(
        await api.api['paid-requests']({ requestType: 'resources' }).put({ appId, ...additional }),
      );
    },
  });

  return {
    values,
    change: function change({ resource, value }) {
      setValues((current) => ({ ...current, [resource]: value }));
      save.reset();
    },
    submit: function submit() {
      if (amounts !== undefined && !save.isPending) {
        save.mutate(amounts);
      }
    },
    pending: save.isPending,
    submittable: amounts !== undefined && !save.isPending,
    savedAmounts: save.data?.requestType === 'resources' ? save.data : undefined,
    error: save.error?.message,
  };
}
