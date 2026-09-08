import { Button } from '@repo/ui/components/button';
import { useBinaryPicker } from '@repo/ui/hooks/use-binary-picker';
import { type LucideIcon, UploadIcon, XIcon } from 'lucide-react';

const REPLACE = 'Drop another to replace it.';

/**
 * One row of the deploy form that takes a file off this machine. Shared between them so that the
 * binary and the archive read as two answers to the same kind of question rather than as two
 * different controls that happen to sit on the same form.
 */
export function FileDropZone({
  inputId,
  file,
  icon: PickedIcon,
  invitation,
  clearLabel,
  invalid,
  onPick,
}: {
  inputId: string;
  file: File | undefined;
  icon: LucideIcon;
  invitation: string;
  clearLabel: string;
  invalid: boolean;
  onPick: (file: File | undefined) => void;
}) {
  const picker = useBinaryPicker({ onPick });

  return (
    <div
      data-dragging={picker.dragging || undefined}
      data-invalid={invalid || undefined}
      className="relative flex w-full items-center gap-2 rounded-2xl border border-muted-foreground/30 border-dashed bg-input/50 px-3 py-4 text-sm transition-[color,background-color,box-shadow] duration-200 hover:bg-input has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/30 data-[dragging=true]:border-ring data-[invalid=true]:border-destructive/50 data-[dragging=true]:border-solid data-[dragging=true]:bg-primary/10"
      {...picker.dropHandlers}
    >
      <input
        ref={picker.inputRef}
        id={inputId}
        type="file"
        className="sr-only"
        aria-invalid={invalid}
        onChange={(event) => onPick(event.target.files?.[0])}
      />
      <label
        htmlFor={inputId}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 font-normal"
      >
        {file === undefined ? (
          <>
            <UploadIcon className="size-4 shrink-0 text-muted-foreground" />
            <span>{invitation}</span>
          </>
        ) : (
          <>
            <PickedIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-mono" title={file.name}>
                {file.name}
              </span>
              <span className="text-muted-foreground text-xs">{REPLACE}</span>
            </span>
          </>
        )}
      </label>
      {file !== undefined && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={clearLabel}
          onClick={picker.clear}
        >
          <XIcon />
        </Button>
      )}
    </div>
  );
}
