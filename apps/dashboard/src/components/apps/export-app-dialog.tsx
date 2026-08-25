import { Button } from '@repo/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/dialog';
import { Spinner } from '@repo/ui/components/spinner';
import { DownloadIcon, TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { formatBytes } from '#lib/format-bytes.ts';
import { useAppExport } from '#lib/hooks/use-app-export.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';

export function ExportAppDialog() {
  const appId = useAppId();
  const [open, setOpen] = useState(false);
  const run = useAppExport(appId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <DownloadIcon data-icon="inline-start" />
        Export
      </DialogTrigger>
      <DialogContent showCloseButton={!run.isPending}>
        <DialogHeader>
          <DialogTitle>Export this app</DialogTitle>
          <DialogDescription>
            One <span className="font-mono">.tar.gz</span> holding the binary this app runs,
            everything on its volume, and a <span className="font-mono">.env</span> of the variables
            it runs with.
          </DialogDescription>
        </DialogHeader>

        <p className="text-muted-foreground text-sm">
          Preparing one reads the whole filesystem, so it can take minutes. Asking again while one
          is being prepared is answered with that same bundle rather than starting a second.
        </p>

        {run.isPending && (
          <div className="flex flex-col gap-1 rounded-2xl bg-muted px-3 py-2 text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Spinner className="shrink-0" />
              {run.exportId === undefined ? 'asking for an export' : 'preparing export'}
            </span>
            {run.exportId !== undefined && (
              <span className="wrap-anywhere font-mono">{run.exportId}</span>
            )}
          </div>
        )}

        {run.isSuccess && (
          <p className="rounded-2xl bg-muted px-3 py-2 text-sm">
            The bundle is downloading
            {run.bundle?.sizeBytes !== undefined && ` — ${formatBytes(run.bundle.sizeBytes)}`}. It
            is named after the app.
          </p>
        )}

        {run.reason !== undefined && (
          <p className="flex items-start gap-2 rounded-2xl bg-destructive/10 px-3 py-2 text-destructive text-sm">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <span className="wrap-anywhere">{run.reason}</span>
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose render={<Button variant="outline" />}>
            {run.isPending ? 'Leave it running' : 'Close'}
          </DialogClose>
          <Button disabled={run.isPending} onClick={run.start}>
            {run.isSuccess ? 'Take another' : 'Prepare the bundle'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
