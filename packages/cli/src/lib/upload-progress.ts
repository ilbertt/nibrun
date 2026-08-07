import type { UploadProgress } from '@repo/app-operations';

const PERCENT_SCALE = 100;
const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
// Early on, the elapsed time is mostly the connection opening, and a guess drawn from it swings
// wildly enough to read as broken. A share this size is where it settles.
const GUESSABLE_SHARE = 0.02;

/**
 * A share and a guess at what is left, rather than a count of bytes: on a link slow enough to make
 * this worth showing, how much longer is the thing worth knowing, and the bytes are the arithmetic
 * behind it rather than the answer.
 *
 * Given the elapsed time rather than reading a clock, so what it says is a function of what it was
 * told.
 */
export function describeProgress({
  progress,
  elapsedMs,
}: {
  progress: UploadProgress;
  elapsedMs: number;
}): string {
  const share = progress.sentBytes / progress.totalBytes;
  const percent = Math.floor(share * PERCENT_SCALE);
  if (share < GUESSABLE_SHARE) {
    return `${percent}%`;
  }
  return `${percent}%, about ${remaining(elapsedMs * (1 / share - 1))} left`;
}

function remaining(ms: number): string {
  const seconds = Math.ceil(ms / MS_PER_SECOND);
  return seconds < SECONDS_PER_MINUTE
    ? `${seconds}s`
    : `${Math.ceil(seconds / SECONDS_PER_MINUTE)}m`;
}
