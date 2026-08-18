import { useBinaryPicker } from '@repo/ui/hooks/use-binary-picker';
import { FileTerminalIcon, LoaderCircleIcon, UploadIcon } from 'lucide-react';
import { type BinaryHandoff, useBinaryHandoff } from '#lib/hooks/use-binary-handoff.ts';

const BINARY_INPUT_ID = 'binary';

export function BinaryDrop() {
  const handoff = useBinaryHandoff();
  const picker = useBinaryPicker({ onPick: handoff.offer });

  return (
    <div className="flex w-full flex-col gap-3">
      <div
        data-dragging={picker.dragging || undefined}
        data-invalid={handoff.failure !== undefined || undefined}
        className="relative rounded-3xl border-2 border-muted-foreground/25 border-dashed bg-input/40 transition-[color,background-color,border-color] duration-200 hover:border-muted-foreground/40 hover:bg-input/70 has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/30 data-[dragging=true]:border-ring data-[invalid=true]:border-destructive/60 data-[dragging=true]:border-solid data-[dragging=true]:bg-primary/10 data-[dragging=true]:ring-4 data-[dragging=true]:ring-primary/20"
        {...picker.dropHandlers}
      >
        <input
          ref={picker.inputRef}
          id={BINARY_INPUT_ID}
          type="file"
          className="sr-only"
          disabled={handoff.sending}
          onChange={(event) => handoff.offer(event.target.files?.[0])}
        />
        <label
          htmlFor={BINARY_INPUT_ID}
          className="flex cursor-pointer flex-col items-center gap-4 px-6 py-16 text-center sm:py-20"
        >
          <Glyph handoff={handoff} />
          <span className="flex flex-col gap-1.5">
            <span className="font-medium text-lg sm:text-xl">Drop it here</span>
            <span className="text-muted-foreground text-sm">{caption(handoff)}</span>
          </span>
        </label>
      </div>
      {handoff.failure !== undefined && (
        <p role="alert" className="text-center text-destructive text-sm">
          {handoff.failure}
        </p>
      )}
    </div>
  );
}

function Glyph({ handoff }: { handoff: BinaryHandoff }) {
  const className = 'size-8 text-muted-foreground';

  if (handoff.sending) {
    return <LoaderCircleIcon className={`${className} animate-spin`} />;
  }
  return handoff.binary === undefined ? (
    <UploadIcon className={className} />
  ) : (
    <FileTerminalIcon className={className} />
  );
}

function caption(handoff: BinaryHandoff): string {
  if (handoff.sending) {
    return `Sending ${handoff.binary?.name}…`;
  }
  if (handoff.binary === undefined) {
    return 'or click to browse';
  }
  return handoff.binary.name;
}
