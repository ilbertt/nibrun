import { Spinner } from '@repo/ui/components/spinner';
import { cn } from '@repo/ui/lib/utils';
import { Trash2Icon } from 'lucide-react';
import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';

const KEYBOARD_STEP = 0.25;
const LABEL_FADE_RATE = 1.6;
const FULL_PERCENT = 100;

export function SlideToDelete({
  label,
  pendingLabel,
  pending,
  onDelete,
}: {
  label: string;
  pendingLabel: string;
  pending: boolean;
  onDelete: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const grabOffset = useRef(0);
  const [dragged, setDragged] = useState(0);
  const [dragging, setDragging] = useState(false);

  const progress = pending ? 1 : dragged;
  const travelled = `calc(${progress} * (100% - var(--slide-handle-size)))`;

  function slideTo(next: number): void {
    if (next < 1) {
      setDragged(Math.max(0, next));
      return;
    }
    // Only `pending` holds the handle at the end, so a deletion that comes back
    // with an error leaves the slider armed at the start for another attempt.
    setDragged(0);
    setDragging(false);
    onDelete();
  }

  function grabHandle(event: PointerEvent<HTMLDivElement>): void {
    if (pending) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    grabOffset.current = event.clientX - event.currentTarget.getBoundingClientRect().left;
    setDragging(true);
  }

  function dragHandle(event: PointerEvent<HTMLDivElement>): void {
    const track = trackRef.current;
    if (!dragging || track === null) {
      return;
    }
    const travel = track.clientWidth - event.currentTarget.offsetWidth;
    if (travel <= 0) {
      return;
    }
    slideTo((event.clientX - track.getBoundingClientRect().left - grabOffset.current) / travel);
  }

  function releaseHandle(): void {
    setDragging(false);
    setDragged(0);
  }

  function stepHandle(event: KeyboardEvent<HTMLDivElement>): void {
    // No End key: reaching the far end takes repeated presses, so the keyboard
    // asks for the same deliberate effort the drag does.
    const stepped = {
      ArrowRight: dragged + KEYBOARD_STEP,
      ArrowUp: dragged + KEYBOARD_STEP,
      ArrowLeft: dragged - KEYBOARD_STEP,
      ArrowDown: dragged - KEYBOARD_STEP,
      Home: 0,
    }[event.key];
    if (stepped === undefined || pending) {
      return;
    }
    event.preventDefault();
    slideTo(stepped);
  }

  return (
    <div
      ref={trackRef}
      className="relative h-(--slide-handle-size) w-full touch-none select-none rounded-full bg-muted [--slide-handle-size:2.75rem]"
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-destructive/15"
        style={{ width: `calc(${travelled} + var(--slide-handle-size))` }}
      />
      <span
        className={cn(
          'pointer-events-none absolute inset-0 flex items-center justify-center gap-2 pr-4 pl-(--slide-handle-size) text-sm',
          pending ? 'text-destructive' : 'text-muted-foreground',
        )}
        style={{ opacity: pending ? 1 : Math.max(0, 1 - progress * LABEL_FADE_RATE) }}
      >
        {pending && <Spinner />}
        <span className="truncate px-2">{pending ? pendingLabel : label}</span>
      </span>
      <div
        role="slider"
        tabIndex={pending ? -1 : 0}
        aria-label={label}
        aria-disabled={pending || undefined}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={FULL_PERCENT}
        aria-valuenow={Math.round(progress * FULL_PERCENT)}
        onPointerDown={grabHandle}
        onPointerMove={dragHandle}
        onPointerUp={releaseHandle}
        onPointerCancel={releaseHandle}
        onKeyDown={stepHandle}
        className={cn(
          'absolute top-0 flex size-(--slide-handle-size) items-center justify-center rounded-full bg-destructive text-destructive-foreground outline-none focus-visible:ring-3 focus-visible:ring-destructive/30',
          pending ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing',
        )}
        style={{ left: travelled }}
      >
        <Trash2Icon />
      </div>
    </div>
  );
}
