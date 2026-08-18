import { FileTerminalIcon, UploadIcon, XIcon } from 'lucide-react';
import { Button } from '#components/ui/button.tsx';
import { useBinaryPicker } from '#lib/hooks/use-binary-picker.ts';

export const BINARY_INPUT_ID = 'deploy-binary';

export function BinaryDropZone({
  binary,
  invalid,
  onPick,
}: {
  binary: File | undefined;
  invalid: boolean;
  onPick: (binary: File | undefined) => void;
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
        id={BINARY_INPUT_ID}
        type="file"
        className="sr-only"
        aria-invalid={invalid}
        onChange={(event) => onPick(event.target.files?.[0])}
      />
      <label
        htmlFor={BINARY_INPUT_ID}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 font-normal"
      >
        {binary === undefined ? (
          <>
            <UploadIcon className="size-4 shrink-0 text-muted-foreground" />
            <span>Drop the binary here, or browse for it.</span>
          </>
        ) : (
          <>
            <FileTerminalIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-mono" title={binary.name}>
                {binary.name}
              </span>
              <span className="text-muted-foreground text-xs">Drop another to replace it.</span>
            </span>
          </>
        )}
      </label>
      {binary !== undefined && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Clear the binary"
          onClick={picker.clear}
        >
          <XIcon />
        </Button>
      )}
    </div>
  );
}
