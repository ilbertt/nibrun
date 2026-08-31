import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';
import { type AppActivation, MAX_IDLE_TIMEOUT_MS, MIN_IDLE_TIMEOUT_MS } from '@repo/protocol';
import { InvalidIdleTimeoutError } from '#errors.ts';

/**
 * The words each activation goes by where it is shown to an owner, and what choosing it costs.
 *
 * Written out rather than derived from the value, which is very nearly the same string, and
 * exhaustive for the reason `APP_STATUS_LABELS` is: an activation added to the protocol is a row
 * missing from here, which is a type error rather than a surface printing an identifier.
 *
 * The cost is beside the label rather than left to whoever renders it, because it is the whole
 * reason someone would leave this off — an owner who is not told about the cold boot finds out
 * about it from a visitor.
 */
export const APP_ACTIVATIONS_EXPLAINED: Record<
  AppActivation,
  { readonly label: string; readonly costs: string }
> = {
  always: {
    label: 'Always on',
    costs: 'The microVM stays up between requests, so every request is answered at once.',
  },
  'on-request': {
    label: 'On request',
    costs:
      'The microVM is stopped once the app has gone quiet and started again by the next request, so the first request after a quiet spell waits for a boot.',
  },
};

/**
 * The two things that stay true of a sleeping app whatever the timeout is set to, and that an
 * owner has no way to find out from the setting itself.
 */
export const ON_REQUEST_LIMITS: readonly string[] = [
  'A websocket that is the first connection to a sleeping app cannot be carried across the wake: it starts the app and is asked to reconnect. Once the app is awake, websockets work normally.',
  'Only requests reaching the app count as activity, so an app that does nothing but outbound work reads as quiet and is stopped.',
];

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;
const MS_PER_HOUR = MS_PER_MINUTE * MINUTES_PER_HOUR;

const FIVE_MINUTES_MS = 300_000;
const A_QUARTER_HOUR_MS = 900_000;
const HALF_AN_HOUR_MS = 1_800_000;

/**
 * The timeouts offered where one is picked from a list rather than typed. Close together at the
 * short end, where a few minutes decides whether the next visitor pays for the gap, and coarser
 * once it is long enough that a few minutes either way changes nothing.
 *
 * Filtered against the floor rather than starting at it by hand: the floor is the cadence the host
 * decides on, and raising it must take the choices that stop being keepable with it.
 */
export const IDLE_TIMEOUT_CHOICES: readonly number[] = [
  MS_PER_MINUTE,
  FIVE_MINUTES_MS,
  A_QUARTER_HOUR_MS,
  HALF_AN_HOUR_MS,
  MS_PER_HOUR,
].filter((ms) => ms >= MIN_IDLE_TIMEOUT_MS);

/** A timeout as it is written and read back: `15m`, `1h`. Whole hours only, so `90m` stays `90m`. */
export function idleTimeoutLabel(ms: number): string {
  return ms % MS_PER_HOUR === 0 ? `${ms / MS_PER_HOUR}h` : `${Math.round(ms / MS_PER_MINUTE)}m`;
}

const UNIT_MS: Record<string, number> = {
  s: MS_PER_SECOND,
  m: MS_PER_MINUTE,
  h: MS_PER_HOUR,
};

const DURATION = /^([1-9][0-9]{0,3})([smh])$/;

/**
 * A timeout as somebody typed it, in milliseconds.
 *
 * The floor is answered here as well as by the api, because the api's refusal is a schema failure
 * quoting a field path: what someone who typed `30s` needs is the sentence saying why a shorter
 * timeout is one nibrun cannot keep.
 */
export function parseIdleTimeout(value: string): number {
  const matched = DURATION.exec(value);
  const unit = matched?.[2];
  if (!matched?.[1] || !unit) {
    throw new InvalidIdleTimeoutError(
      `${value} is not a duration. Write one as 90s, 15m or 2h — a whole number and a unit.`,
    );
  }
  const ms = Number(matched[1]) * (UNIT_MS[unit] ?? MS_PER_MINUTE);
  if (ms < MIN_IDLE_TIMEOUT_MS) {
    throw new InvalidIdleTimeoutError(
      `${value} is shorter than ${idleTimeoutLabel(MIN_IDLE_TIMEOUT_MS)}, which is how often a host measures whether an app has gone quiet. Anything shorter is a timeout it would accept and could not keep.`,
    );
  }
  if (ms > MAX_IDLE_TIMEOUT_MS) {
    throw new InvalidIdleTimeoutError(
      `${value} is longer than ${idleTimeoutLabel(MAX_IDLE_TIMEOUT_MS)}, which is as long as a wait can be written. An app that should never sleep is one set to always, rather than one given a timeout nothing reaches.`,
    );
  }
  return ms;
}

/**
 * An edit to how the app comes up: what it names is set, and what it leaves out keeps what it had.
 * Naming neither is a read, which is what a surface showing the setting asks for.
 */
export type ActivationEdit = {
  activation?: AppActivation | undefined;
  idleTimeoutMs?: number | undefined;
};

export type ActivatedApp = {
  slug: string;
  activation: AppActivation;
  idleTimeoutMs: number;
};

/** How the app comes up, in the one line that says it — the timeout only where it is read. */
export function activationSummary(app: Omit<ActivatedApp, 'slug'>): string {
  const { label } = APP_ACTIVATIONS_EXPLAINED[app.activation];
  return app.activation === 'on-request'
    ? `${label}, stopped after ${idleTimeoutLabel(app.idleTimeoutMs)} of quiet`
    : label;
}

/**
 * Change how the app is brought up. Nothing is deployed and no release is replaced: a host reads
 * this off the app row, so the next poll is the whole of it.
 */
export async function setActivation({
  api,
  appId,
  edit,
}: {
  api: PublicApiClient;
  appId: string;
  edit: ActivationEdit;
}): Promise<ActivatedApp> {
  return unwrap(await api.api.apps({ appId }).activation.patch(edit));
}
