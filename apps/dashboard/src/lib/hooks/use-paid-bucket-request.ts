import { unwrap } from '@repo/api-client/unwrap';
import { useMutation } from '@tanstack/react-query';
import { api } from '#lib/api.ts';

type PaidBucketRequestForm = {
  submit: () => void;
  pending: boolean;
  saved: boolean;
  error: string | undefined;
};

export function usePaidBucketRequest(): PaidBucketRequestForm {
  const save = useMutation({
    mutationFn: async function savePaidBucketRequest() {
      return unwrap(await api.api['paid-requests']({ requestType: 'custom-bucket' }).put({}));
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
