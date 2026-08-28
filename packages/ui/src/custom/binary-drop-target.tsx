import { useBinaryPicker } from '@repo/ui/hooks/use-binary-picker';
import { FileTerminalIcon, LoaderCircleIcon, UploadIcon } from 'lucide-react';
import type { ReactNode } from 'react';

const BROWSE = 'or click to browse';

/**
 * The whole surface an owner drops a binary onto, in the one size that reads as the only thing on
 * the page to do. The landing page and a deploy link stripped to its binary are the same moment
 * seen from either side of signing in, so they are the same target.
 */
export function BinaryDropTarget({
  inputId,
  binary,
  title,
  caption,
  busy = false,
  invalid = false,
  onPick,
}: {
  inputId: string;
  binary: File | undefined;
  title: ReactNode;
  caption?: string | undefined;
  busy?: boolean | undefined;
  invalid?: boolean | undefined;
  onPick: (binary: File | undefined) => void;
}) {
  const picker = useBinaryPicker({ onPick });

  return (
    <div
      data-dragging={picker.dragging || undefined}
      data-invalid={invalid || undefined}
      className="relative rounded-3xl border-2 border-muted-foreground/25 border-dashed bg-input/40 transition-[color,background-color,border-color] duration-200 hover:border-muted-foreground/40 hover:bg-input/70 has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/30 data-[dragging=true]:border-ring data-[invalid=true]:border-destructive/60 data-[dragging=true]:border-solid data-[dragging=true]:bg-primary/10 data-[dragging=true]:ring-4 data-[dragging=true]:ring-primary/20"
      {...picker.dropHandlers}
    >
      <input
        ref={picker.inputRef}
        id={inputId}
        type="file"
        className="sr-only"
        aria-invalid={invalid}
        disabled={busy}
        onChange={(event) => onPick(event.target.files?.[0])}
      />
      <label
        htmlFor={inputId}
        className="flex cursor-pointer flex-col items-center gap-4 px-6 py-16 text-center sm:py-20"
      >
        <Glyph binary={binary} busy={busy} />
        <span className="flex flex-col gap-1.5">
          <span className="font-medium text-lg sm:text-xl">{title}</span>
          <span className="wrap-anywhere text-muted-foreground text-sm">
            {caption ?? binary?.name ?? BROWSE}
          </span>
        </span>
      </label>
    </div>
  );
}

function Glyph({ binary, busy }: { binary: File | undefined; busy: boolean }) {
  const className = 'size-8 text-muted-foreground';

  if (busy) {
    return <LoaderCircleIcon className={`${className} animate-spin`} />;
  }
  return binary === undefined ? (
    <UploadIcon className={className} />
  ) : (
    <FileTerminalIcon className={className} />
  );
}
