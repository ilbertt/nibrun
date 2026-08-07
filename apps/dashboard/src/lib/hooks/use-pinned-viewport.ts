import { type RefObject, useLayoutEffect, useRef } from 'react';

const VIEWPORT_SELECTOR = '[data-slot="scroll-area-viewport"]';
const PIN_TOLERANCE_PX = 32;

export function usePinnedViewport(newest: unknown): RefObject<HTMLDivElement | null> {
  const containerRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useLayoutEffect(() => {
    const viewport = viewportOf(containerRef.current);
    if (viewport === null) {
      return;
    }
    return watchPin({ viewport, pinned });
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportOf(containerRef.current);
    if (viewport === null || !pinned.current) {
      return;
    }
    viewport.scrollTop = viewport.scrollHeight;
  }, [newest]);

  return containerRef;
}

function viewportOf(container: HTMLDivElement | null): HTMLElement | null {
  return container?.querySelector<HTMLElement>(VIEWPORT_SELECTOR) ?? null;
}

function watchPin({
  viewport,
  pinned,
}: {
  viewport: HTMLElement;
  pinned: RefObject<boolean>;
}): () => void {
  function readPin() {
    const distanceToEnd = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    pinned.current = distanceToEnd <= PIN_TOLERANCE_PX;
  }

  viewport.addEventListener('scroll', readPin, { passive: true });
  return () => viewport.removeEventListener('scroll', readPin);
}
