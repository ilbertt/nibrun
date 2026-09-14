import { AppNameSchema, Value } from '@repo/protocol';
import { Button } from '@repo/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/dialog';
import { Field, FieldError, FieldLabel } from '@repo/ui/components/field';
import { Input } from '@repo/ui/components/input';
import { Spinner } from '@repo/ui/components/spinner';
import { revalidateLogic, useForm } from '@tanstack/react-form';
import { PencilIcon } from 'lucide-react';
import { useState } from 'react';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useUpdateApp } from '#lib/hooks/use-update-app.ts';

export function RenameAppDialog({ name }: { name: string }) {
  const update = useUpdateApp(useAppId());
  const [open, setOpen] = useState(false);

  const form = useForm({
    defaultValues: { name },
    validationLogic: revalidateLogic(),
    onSubmit: ({ value }) => {
      update.mutate({ name: value.name.trim() }, { onSuccess: () => setOpen(false) });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        form.reset();
        update.reset();
      }}
    >
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Rename" />}>
        <PencilIcon />
      </DialogTrigger>
      <DialogContent showCloseButton={!update.isPending}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename this app</DialogTitle>
            <DialogDescription>
              The name is what you refer to the app by, here and with{' '}
              <span className="font-mono">nib</span>. Its hostnames stay as they are.
            </DialogDescription>
          </DialogHeader>

          <form.Field name="name" validators={{ onDynamic: validateName }}>
            {(field) => {
              // The api's refusal reads as a field error too: it is about this name, and there is
              // nowhere else on the form for it to go.
              const refused = field.state.meta.errors[0] ?? update.error?.message;
              return (
                <Field data-invalid={refused !== undefined || undefined}>
                  <FieldLabel htmlFor="app-name">Name</FieldLabel>
                  <Input
                    id="app-name"
                    value={field.state.value}
                    autoComplete="off"
                    autoFocus
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  {refused === undefined ? null : <FieldError>{refused}</FieldError>}
                </Field>
              );
            }}
          </form.Field>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={update.isPending} />}>
              Cancel
            </DialogClose>
            <form.Subscribe selector={(state) => state.values.name.trim()}>
              {(typed) => (
                <Button type="submit" disabled={typed === '' || typed === name || update.isPending}>
                  {update.isPending ? <Spinner /> : 'Rename'}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function validateName({ value }: { value: string }): string | undefined {
  return Value.Check(AppNameSchema, value.trim())
    ? undefined
    : `A name is 1 to ${AppNameSchema.maxLength} characters.`;
}
