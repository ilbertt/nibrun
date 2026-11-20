import { unwrap } from '@repo/api-client/unwrap';
import { MIN_PAID_PORTS_REQUEST } from '@repo/api-constants';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '#lib/api.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { paidPortsAmount } from '#lib/paid-ports-request.ts';

type PaidExtraPortRequestForm = {
  value: string;
  change: (value: string) => void;
  submit: () => void;
  submittable: boolean;
  pending: boolean;
  savedAmount: number | undefined;
  error: string | undefined;
};

export function usePaidExtraPortRequest(): PaidExtraPortRequestForm {
  const appId = useAppId();
  const [value, setValue] = useState(String(MIN_PAID_PORTS_REQUEST));
  const amount = paidPortsAmount(value);
  const save = useMutation({
    mutationFn: async function savePaidExtraPortRequest(requestedPortsAmount: number) {
      return unwrap(
        await api.api['paid-requests']({ requestType: 'extra-public-port' }).put({
          appId,
          requestedPortsAmount,
        }),
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
    savedAmount:
      save.data?.requestType === 'extra-public-port' ? save.data.requestedPortsAmount : undefined,
    error: save.error?.message,
  };
}
