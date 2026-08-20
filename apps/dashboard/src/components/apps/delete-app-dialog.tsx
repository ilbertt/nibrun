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
import { Field, FieldError, FieldLabel } from '@repo/ui/components/field';
import { Input } from '@repo/ui/components/input';
import { Spinner } from '@repo/ui/components/spinner';
import { Trash2Icon, TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '#lib/hooks/use-app.ts';
import { useAppDeletion } from '#lib/hooks/use-app-deletion.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';

const CONFIRMATION_PHRASE = 'delete permanently';

export function DeleteAppDialog() {
  const appId = useAppId();
  const app = useApp(appId);
  const deletion = useAppDeletion(appId);
  const [typed, setTyped] = useState('');

  const slug = app.data?.slug;
  const alreadyDeleting = app.data?.state === 'deleting';

  return (
    <AlertDialog onOpenChange={() => setTyped('')}>
      <AlertDialogTrigger
        render={<Button variant="destructive" disabled={slug === undefined || alreadyDeleting} />}
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

        <Field data-invalid={deletion.isError || undefined}>
          <FieldLabel htmlFor="delete-confirmation">
            Type <span className="font-mono">{CONFIRMATION_PHRASE}</span> to delete {slug}
          </FieldLabel>
          <Input
            id="delete-confirmation"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={CONFIRMATION_PHRASE}
            autoComplete="off"
          />
          {deletion.isError && <FieldError>{deletion.error.message}</FieldError>}
        </Field>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={deletion.isPending}>Keep the app</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!saysDeletePermanently(typed) || deletion.isPending}
            onClick={() => deletion.mutate()}
          >
            {deletion.isPending && <Spinner />}
            Delete {slug}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function saysDeletePermanently(typed: string): boolean {
  return typed.trim().toLowerCase() === CONFIRMATION_PHRASE;
}
