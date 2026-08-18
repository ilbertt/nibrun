import { type DragEvent, type RefObject, useRef, useState } from 'react';

type DropHandlers = {
  onDragEnter: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
};

export type BinaryPicker = {
  inputRef: RefObject<HTMLInputElement | null>;
  dragging: boolean;
  clear: () => void;
  dropHandlers: DropHandlers;
};

export function useBinaryPicker({
  onPick,
}: {
  onPick: (binary: File | undefined) => void;
}): BinaryPicker {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function clear(): void {
    forgetPicked(inputRef.current);
    onPick(undefined);
    inputRef.current?.focus();
  }

  function armDrop(event: DragEvent<HTMLElement>): void {
    if (!carriesFiles(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  }

  function disarmDrop(event: DragEvent<HTMLElement>): void {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragging(false);
    }
  }

  function takeDrop(event: DragEvent<HTMLElement>): void {
    if (!carriesFiles(event)) {
      return;
    }
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped !== undefined) {
      // A file input reports no change for the file it already holds, so emptying it
      // keeps a dropped binary from shadowing the same one picked afterwards.
      forgetPicked(inputRef.current);
      onPick(dropped);
    }
  }

  return {
    inputRef,
    dragging,
    clear,
    dropHandlers: {
      onDragEnter: armDrop,
      onDragOver: armDrop,
      onDragLeave: disarmDrop,
      onDrop: takeDrop,
    },
  };
}

function carriesFiles(event: DragEvent<HTMLElement>): boolean {
  return event.dataTransfer.types.includes('Files');
}

function forgetPicked(input: HTMLInputElement | null): void {
  if (input !== null) {
    input.value = '';
  }
}
