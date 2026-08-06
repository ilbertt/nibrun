/**
 * Pause, and stop pausing the moment the caller's request is gone.
 *
 * A poll that finds nothing has to wait before asking again, and the wait is the whole of what a
 * request held open is doing — so a reader who navigates away, or a ceiling that expires, must end
 * it rather than be noticed one interval later. Resolving on either is what lets the loop above
 * read its own signal to decide which happened.
 */
export function wait({ ms, signal }: { ms: number; signal: AbortSignal }): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  const { promise, resolve } = Promise.withResolvers<void>();
  const timer = setTimeout(() => resolve(), ms);

  // Deliberately never removed. Taking the last listener off a signal from `AbortSignal.timeout`
  // stops its timer for good — Bun 1.4 drops it, and re-listening does not bring it back — so
  // tidying up here is what would keep the ceiling above from ever firing. One listener per pause
  // is bounded by the life of the request that owns the signal.
  signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timer);
      resolve();
    },
    { once: true },
  );
  return promise;
}
