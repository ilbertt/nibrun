import {
  type ActivationEdit,
  APP_ACTIVATIONS_EXPLAINED,
  IDLE_TIMEOUT_CHOICES,
  idleTimeoutLabel,
  ON_REQUEST_LIMITS,
} from '@repo/app-operations';
import { APP_ACTIVATIONS, type AppActivation } from '@repo/protocol';
import { Button } from '@repo/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@repo/ui/components/dropdown-menu';
import { DialogBody } from '@repo/ui/custom/dialog-body';
import { cn } from '@repo/ui/lib/utils';
import { CheckIcon, ChevronDownIcon, PencilIcon } from 'lucide-react';
import { useState } from 'react';
import { useAppActivation } from '#lib/hooks/use-app-activation.ts';
import { useFailureToast } from '#lib/hooks/use-failure-toast.ts';
import type { AppSummary } from '#queries/apps.ts';

type Chosen = Required<ActivationEdit>;

function chosenOf(app: AppSummary): Chosen {
  return { activation: app.activation, idleTimeoutMs: app.idleTimeoutMs };
}

/**
 * Both choices with what each one costs, rather than a switch and a paragraph: the cold boot the
 * first visitor after a quiet spell pays is the whole reason an owner would leave this off, and a
 * cost only readable after the choice is made is one they find out about from a visitor.
 */
export function AppActivationDialog({ app }: { app: AppSummary }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Chosen>(chosenOf(app));
  const activation = useAppActivation(app.id);
  useFailureToast(activation.error?.message);

  function handleOpenChange(next: boolean): void {
    if (next) {
      activation.reset();
      setChosen(chosenOf(app));
    }
    setOpen(next);
  }

  function save(): void {
    activation.mutate(chosen, { onSuccess: () => setOpen(false) });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="xs" />}>
        <PencilIcon data-icon="inline-start" />
        Edit
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Activation</DialogTitle>
          <DialogDescription>
            How {app.slug} is brought up. Nothing is deployed and no release is replaced — its host
            reads this on its next poll.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              {APP_ACTIVATIONS.map((value) => (
                <ActivationChoice
                  key={value}
                  value={value}
                  picked={chosen.activation === value}
                  onPick={() => setChosen({ ...chosen, activation: value })}
                />
              ))}
            </div>
            {chosen.activation === 'on-request' && (
              <>
                <IdleTimeoutRow
                  chosen={chosen.idleTimeoutMs}
                  onPick={(idleTimeoutMs) => setChosen({ ...chosen, idleTimeoutMs })}
                />
                <OnRequestLimits />
              </>
            )}
            <Button size="lg" disabled={activation.isPending} onClick={() => save()}>
              Save
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function ActivationChoice({
  value,
  picked,
  onPick,
}: {
  value: AppActivation;
  picked: boolean;
  onPick: () => void;
}) {
  const { label, costs } = APP_ACTIVATIONS_EXPLAINED[value];

  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={picked}
      className={cn(
        'flex flex-col gap-1 rounded-xl border px-3 py-2 text-left transition-colors',
        picked ? 'border-primary bg-muted/60' : 'hover:bg-muted/40',
      )}
    >
      <span className="flex items-center gap-1.5 font-medium">
        {label}
        {picked && <CheckIcon className="size-3.5 text-primary" />}
      </span>
      <span className="text-muted-foreground text-xs">{costs}</span>
    </button>
  );
}

function IdleTimeoutRow({
  chosen,
  onPick,
}: {
  chosen: number;
  onPick: (idleTimeoutMs: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">Stopped after</span>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
          {idleTimeoutLabel(chosen)}
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-24" align="end">
          <DropdownMenuRadioGroup
            value={String(chosen)}
            onValueChange={(value: string) => onPick(Number(value))}
          >
            {IDLE_TIMEOUT_CHOICES.map((ms) => (
              <DropdownMenuRadioItem key={ms} value={String(ms)}>
                {idleTimeoutLabel(ms)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** What stays true of a sleeping app however long its timeout is, which the dial does not say. */
function OnRequestLimits() {
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-4 text-muted-foreground text-xs">
      {ON_REQUEST_LIMITS.map((limit) => (
        <li key={limit}>{limit}</li>
      ))}
    </ul>
  );
}
