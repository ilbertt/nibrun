import { unwrap } from '@repo/api-client/unwrap';
import { currentPaidResourceAmounts, type PaidResourceAmounts } from '@repo/app-operations';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '#lib/api.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { type PaidResourceValues, paidResourceAmounts } from '#lib/paid-resources-request.ts';
import { appQueryOptions } from '#queries/apps.ts';

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
  const { data: app } = useSuspenseQuery(appQueryOptions(appId));
  const [values, setValues] = useState<PaidResourceValues>(function currentValues() {
    const current = currentPaidResourceAmounts(app.config);
    return {
      requestedVcpuCount: String(current.requestedVcpuCount),
      requestedMemoryMib: String(current.requestedMemoryMib),
      requestedVolumeGib: String(current.requestedVolumeGib),
    };
  });
  const amounts = paidResourceAmounts(values);
  const save = useMutation({
    mutationFn: async function savePaidResourcesRequest(requested: PaidResourceAmounts) {
      return unwrap(
        await api.api['paid-requests']({ requestType: 'resources' }).put({ appId, ...requested }),
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
