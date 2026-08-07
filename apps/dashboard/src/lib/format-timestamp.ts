const DAY_AND_MINUTE: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

export function dayAndMinute(instant: string): string {
  return new Date(instant).toLocaleString(undefined, DAY_AND_MINUTE);
}
