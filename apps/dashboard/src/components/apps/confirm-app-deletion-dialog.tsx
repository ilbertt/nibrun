import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@repo/ui/components/alert-dialog';
import { Field, FieldError } from '@repo/ui/components/field';
import { SlideToDelete } from '@repo/ui/custom/slide-to-delete';
import { useApp } from '#lib/hooks/use-app.ts';
import { useAppDeletion } from '#lib/hooks/use-app-deletion.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';

export function ConfirmAppDeletionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const appId = useAppId();
  const app = useApp(appId);
  const deletion = useAppDeletion(appId);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Last step</AlertDialogTitle>
          <AlertDialogDescription>
            Slide the handle all the way across, and {app.data?.slug} is gone for good.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Field data-invalid={deletion.isError || undefined}>
          <SlideToDelete
            label="Slide to delete"
            pendingLabel="Deleting…"
            pending={deletion.isPending}
            onDelete={() => deletion.mutate()}
          />
          {deletion.isError && <FieldError>{deletion.error.message}</FieldError>}
        </Field>

        <AlertDialogFooter className="sm:justify-center">
          <AlertDialogCancel disabled={deletion.isPending}>Keep the app</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
