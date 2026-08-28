import { BinaryDropTarget } from '@repo/ui/custom/binary-drop-target';
import { type BinaryHandoff, useBinaryHandoff } from '#lib/hooks/use-binary-handoff.ts';

const BINARY_INPUT_ID = 'binary';

export function BinaryDrop() {
  const handoff = useBinaryHandoff();

  return (
    <div className="flex w-full flex-col gap-3">
      <BinaryDropTarget
        inputId={BINARY_INPUT_ID}
        binary={handoff.binary}
        title="Drop it here"
        caption={sending(handoff)}
        busy={handoff.sending}
        invalid={handoff.failure !== undefined}
        onPick={handoff.offer}
      />
      {handoff.failure !== undefined && (
        <p role="alert" className="text-center text-destructive text-sm">
          {handoff.failure}
        </p>
      )}
    </div>
  );
}

/** The one thing the target cannot say for itself: a binary of its own is already on its way. */
function sending(handoff: BinaryHandoff): string | undefined {
  return handoff.sending ? `Sending ${handoff.binary?.name}…` : undefined;
}
