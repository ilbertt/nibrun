const DAY_AND_MINUTE: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

const TIME_OF_DAY: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hour12: false,
};

// A deployment's whole life can happen inside one minute — staged, started, serving, gone — so
// anything reading it as a sequence needs the seconds that tell those moments apart.
const DAY_AND_SECOND: Intl.DateTimeFormatOptions = { ...DAY_AND_MINUTE, second: '2-digit' };

export function dayAndSecond(instant: string): string {
  return new Date(instant).toLocaleString(undefined, DAY_AND_SECOND);
}

export function dayAndMinute(instant: string): string {
  return new Date(instant).toLocaleString(undefined, DAY_AND_MINUTE);
}

export function timeOfDay(instant: string): string {
  return new Date(instant).toLocaleTimeString(undefined, TIME_OF_DAY);
}
