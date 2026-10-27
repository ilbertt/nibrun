import { unwrap } from '@repo/api-client/unwrap';
import { useMutation } from '@tanstack/react-query';
import { api } from '#lib/api.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';

type PaidAlwaysOnRequestForm = {
  submit: () => void;
  pending: boolean;
  saved: boolean;
  error: string | undefined;
};

export function usePaidAlwaysOnRequest(): PaidAlwaysOnRequestForm {
  const appId = useAppId();
  const save = useMutation({
    mutationFn: async function savePaidAlwaysOnRequest() {
      return unwrap(await api.api['paid-requests']({ requestType: 'always-on' }).put({ appId }));
    },
  });

  return {
    submit: function submit() {
      if (!save.isPending && !save.isSuccess) {
        save.mutate();
      }
    },
    pending: save.isPending,
    saved: save.isSuccess,
    error: save.error?.message,
  };
}
