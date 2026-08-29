const BYTES_PER_KIB = 1_024;
const UNITS = ['bytes', 'KiB', 'MiB', 'GiB', 'TiB'] as const;
const LAST_UNIT = UNITS.length - 1;
const SCALED_DECIMALS = 1;

/**
 * A size as somebody reads it rather than as it is counted.
 *
 * Rounded, unlike the sizes `nib apps files ls` prints: there the reader is checking what their
 * binary wrote and two listings have to be comparable, so an exact count is the whole point. Here
 * the question is how much of an allocation is spent, and `1.4 GiB of 8.0 GiB` answers it where
 * ten digits against another ten does not.
 */
export function formatBytes(bytes: number): string {
  let scaled = bytes;
  let unit = 0;
  while (scaled >= BYTES_PER_KIB && unit < LAST_UNIT) {
    scaled /= BYTES_PER_KIB;
    unit++;
  }
  return unit === 0 ? `${bytes} ${UNITS[0]}` : `${scaled.toFixed(SCALED_DECIMALS)} ${UNITS[unit]}`;
}
