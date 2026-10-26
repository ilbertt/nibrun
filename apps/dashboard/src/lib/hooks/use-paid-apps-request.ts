import { unwrap } from '@repo/api-client/unwrap';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '#lib/api.ts';
import { paidAppsAmount } from '#lib/paid-apps-request.ts';

type PaidAppsRequestForm = {
  value: string;
  change: (value: string) => void;
  submit: () => void;
  pending: boolean;
  submittable: boolean;
  error: string | undefined;
  savedAmount: number | undefined;
};

export function usePaidAppsRequest(): PaidAppsRequestForm {
  const [value, setValue] = useState('');
  const amount = paidAppsAmount(value);
  const save = useMutation({
    mutationFn: async function savePaidApps(total: number) {
      return unwrap(
        await api.api['paid-requests']({ requestType: 'apps' }).put({ requestedAppsAmount: total }),
      );
    },
  });

  return {
    value,
    change: function change(next) {
      setValue(next);
      save.reset();
    },
    submit: function submit() {
      if (amount !== undefined && !save.isPending) {
        save.mutate(amount);
      }
    },
    pending: save.isPending,
    submittable: amount !== undefined && !save.isPending,
    error: save.error?.message,
    savedAmount: save.data?.requestType === 'apps' ? save.data.requestedAppsAmount : undefined,
  };
}
