import { FileTerminalIcon } from 'lucide-react';
import { FileDropZone } from '#components/deploy/file-drop-zone.tsx';

export const BINARY_INPUT_ID = 'deploy-binary';

export function BinaryDropZone({
  binary,
  invalid,
  keeping,
  onPick,
}: {
  binary: File | undefined;
  invalid: boolean;
  keeping: boolean;
  onPick: (binary: File | undefined) => void;
}) {
  return (
    <FileDropZone
      inputId={BINARY_INPUT_ID}
      file={binary}
      icon={FileTerminalIcon}
      invitation={
        keeping
          ? 'Drop a binary here to replace the one it runs.'
          : 'Drop the binary here, or browse for it.'
      }
      clearLabel="Clear the binary"
      invalid={invalid}
      onPick={onPick}
    />
  );
}
