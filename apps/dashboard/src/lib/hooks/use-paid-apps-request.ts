import type { PaidRequest } from '@repo/api-client/models';
import { unwrap } from '@repo/api-client/unwrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '#lib/api.ts';
import { paidAppsAmount } from '#lib/paid-apps-request.ts';
import { paidRequestsQueryOptions } from '#queries/paid-requests.ts';

type PaidAppsRequestForm = {
  value: string;
  change: (value: string) => void;
  submit: () => void;
  pending: boolean;
  submittable: boolean;
  error: string | undefined;
  loadFailed: boolean;
  savedAmount: number | undefined;
};

export function usePaidAppsRequest(): PaidAppsRequestForm {
  const queryClient = useQueryClient();
  const requests = useQuery(paidRequestsQueryOptions);
  const previous = requests.data?.find((request) => request.requestType === 'apps');
  const [edited, setEdited] = useState<string | undefined>(undefined);
  const value = edited ?? previous?.amount.toString() ?? '';
  const amount = paidAppsAmount(value);
  const save = useMutation({
    mutationFn: async function savePaidApps(total: number) {
      return unwrap(await api.api['paid-requests']({ requestType: 'apps' }).put({ amount: total }));
    },
    onSuccess: function saved(request) {
      queryClient.setQueryData(
        paidRequestsQueryOptions.queryKey,
        function updateRequests(current: PaidRequest[] | undefined) {
          return [
            ...(current ?? []).filter((entry) => entry.requestType !== request.requestType),
            request,
          ];
        },
      );
      setEdited(undefined);
    },
  });

  return {
    value,
    change: function change(next) {
      setEdited(next);
      save.reset();
    },
    submit: function submit() {
      if (amount !== undefined && !save.isPending && !requests.isPending) {
        save.mutate(amount);
      }
    },
    pending: save.isPending,
    submittable: amount !== undefined && !save.isPending && !requests.isPending,
    error: save.error?.message,
    loadFailed: requests.isError,
    savedAmount: save.data?.amount,
  };
}
