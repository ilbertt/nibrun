import { awaitExportBundle, type ExportBundle, requestExport } from '@repo/app-operations';
import { type UseMutationResult, useMutation } from '@tanstack/react-query';
import { api } from '#lib/api.ts';
import { downloadFileFromUrl } from '#lib/download-file-from-url.ts';

export type AppExport = {
  exportId: string | undefined;
  isPending: boolean;
  isSuccess: boolean;
  bundle: ExportBundle | undefined;
  reason: string | undefined;
  start: () => void;
};

export function useAppExport(appId: string): AppExport {
  const bundle = useMutation<ExportBundle, Error, string>({
    mutationFn: (exportId) => awaitExportBundle({ api, appId, exportId }),
    onSuccess: (ready) => downloadFileFromUrl(ready.downloadUrl),
  });

  const requested: UseMutationResult<{ id: string }, Error, void> = useMutation({
    mutationFn: () => requestExport({ api, appId }),
    onSuccess: (each) => bundle.mutate(each.id),
  });

  return {
    exportId: requested.data?.id,
    isPending: requested.isPending || bundle.isPending,
    isSuccess: bundle.isSuccess,
    bundle: bundle.data,
    reason: requested.error?.message ?? bundle.error?.message,
    start: () => {
      bundle.reset();
      requested.mutate();
    },
  };
}
