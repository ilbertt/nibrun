export const LOG_TIMERANGES = [
  { value: '5m', label: 'Last 5 minutes' },
  { value: '15m', label: 'Last 15 minutes' },
  { value: '1h', label: 'Last hour' },
  { value: '6h', label: 'Last 6 hours' },
  { value: '12h', label: 'Last 12 hours' },
  { value: '24h', label: 'Last 24 hours' },
] as const;

export type LogTimerangeChoice = (typeof LOG_TIMERANGES)[number]['value'];

export function isLogTimerangeChoice(value: unknown): value is LogTimerangeChoice {
  return LOG_TIMERANGES.some((timerange) => timerange.value === value);
}
