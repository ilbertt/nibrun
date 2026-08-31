import type { AppActivation } from '@repo/protocol';

/**
 * The words each activation goes by where it is shown to an owner.
 *
 * Written out rather than derived from the value, which is very nearly the same string, and
 * exhaustive for the reason `APP_STATUS_LABELS` is: an activation added to the protocol is a row
 * missing from here, which is a type error rather than a surface printing an identifier.
 */
export const APP_ACTIVATION_LABELS: Record<AppActivation, string> = {
  always: 'Always on',
  'on-request': 'On request',
};

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;
const MS_PER_HOUR = MS_PER_MINUTE * MINUTES_PER_HOUR;

/** A timeout as it is read back: `15m`, `1h`. Whole hours only, so `90m` stays `90m`. */
export function idleTimeoutLabel(ms: number): string {
  return ms % MS_PER_HOUR === 0 ? `${ms / MS_PER_HOUR}h` : `${Math.round(ms / MS_PER_MINUTE)}m`;
}

export type ActivatedApp = {
  activation: AppActivation;
  idleTimeoutMs: number;
};

/**
 * How the app comes up, in the one line that says it.
 *
 * The timeout only where it is read: every app carries one whatever its activation, and naming a
 * wait beside `always` reads as a rule the app is ignoring rather than one it is not under.
 */
export function activationSummary({ activation, idleTimeoutMs }: ActivatedApp): string {
  const label = APP_ACTIVATION_LABELS[activation];
  return activation === 'on-request'
    ? `${label}, stopped after ${idleTimeoutLabel(idleTimeoutMs)} of quiet`
    : label;
}
