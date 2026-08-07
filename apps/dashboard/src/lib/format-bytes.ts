const BYTES_PER_KIB = 1_024;
const UNITS = ['bytes', 'KiB', 'MiB', 'GiB', 'TiB'] as const;
const LAST_UNIT = UNITS.length - 1;
const SCALED_DECIMALS = 1;

export function formatBytes(bytes: number): string {
  let scaled = bytes;
  let unit = 0;
  while (scaled >= BYTES_PER_KIB && unit < LAST_UNIT) {
    scaled /= BYTES_PER_KIB;
    unit++;
  }
  return unit === 0 ? `${bytes} ${UNITS[0]}` : `${scaled.toFixed(SCALED_DECIMALS)} ${UNITS[unit]}`;
}
