import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@repo/ui/components/alert-dialog';
import { Button } from '@repo/ui/components/button';
import { Field, FieldError } from '@repo/ui/components/field';
import { SlideToDelete } from '@repo/ui/custom/slide-to-delete';
import { Trash2Icon, TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import type { AppActionAvailability } from '#lib/app-actions.ts';
import { useApp } from '#lib/hooks/use-app.ts';
import { useAppDeletion } from '#lib/hooks/use-app-deletion.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';

export function DeleteAppDialog({ availability }: { availability: AppActionAvailability }) {
  const appId = useAppId();
  const app = useApp(appId);
  const deletion = useAppDeletion(appId);
  const [armed, setArmed] = useState(false);

  if (availability === 'hidden') {
    return null;
  }

  const slug = app.data?.slug;
  const alreadyDeleting = app.data?.state === 'deleting';

  return (
    <AlertDialog
      onOpenChange={() => {
        setArmed(false);
        deletion.reset();
      }}
    >
      <AlertDialogTrigger
        render={<Button variant="destructive" disabled={availability === 'disabled'} />}
      >
        <Trash2Icon data-icon="inline-start" />
        {alreadyDeleting ? 'Deleting…' : 'Delete'}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <TriangleAlertIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete {slug}?</AlertDialogTitle>
          <AlertDialogDescription>
            This cannot be undone, and nothing here is recoverable afterwards.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <dl className="flex flex-col gap-2 rounded-2xl bg-muted px-3 py-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="shrink-0 text-muted-foreground">app</dt>
            <dd className="truncate font-mono">{slug}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="shrink-0 text-muted-foreground">hostnames</dt>
            <dd className="flex min-w-0 flex-col text-right font-mono">
              {app.data?.hostnames.map((each) => (
                <span key={each.hostname} className="truncate">
                  {each.hostname}
                </span>
              ))}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="shrink-0 text-muted-foreground">volume</dt>
            <dd>everything on it</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="shrink-0 text-muted-foreground">binaries</dt>
            <dd>every one ever uploaded</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="shrink-0 text-muted-foreground">exports</dt>
            <dd>every bundle ever taken</dd>
          </div>
        </dl>

        {armed && (
          <Field data-invalid={deletion.isError || undefined}>
            <SlideToDelete
              label="Slide to delete"
              pendingLabel="Deleting…"
              pending={deletion.isPending}
              autoFocus
              onDelete={() => deletion.mutate()}
            />
            {deletion.isError && <FieldError>{deletion.error.message}</FieldError>}
          </Field>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={deletion.isPending}>Keep the app</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={armed} onClick={() => setArmed(true)}>
            Delete {slug}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
