import { LOG_TIMERANGE_PATTERN } from '@repo/api-constants';
import { stringEnum } from '@repo/typebox-extensions';
import { Type } from '@sinclair/typebox';

/**
 * Which component wrote a record, and the one field that answers it for the whole fleet.
 *
 * Uppercase, alone among our fields, because it is the only one two very different writers have
 * to agree on. The agent stamps it on tenant output; every other component on an app host reaches
 * the store through its journal, where systemd requires field names to be uppercase — so a
 * lowercase name here would mean `source:tenant` and `SOURCE:agent` were the same question asked
 * two ways, and a query would have to know which half of the fleet it was addressing first.
 */
export const LOG_SOURCES = ['tenant', 'agent', 'firecracker', 'zerofs', 'caddy'] as const;
export const LogSourceSchema = stringEnum(LOG_SOURCES);
export type LogSource = (typeof LOG_SOURCES)[number];

/**
 * How much history a reader asks for before it starts following, as a duration such as `30s`.
 *
 * A duration rather than a number of lines, because the store is asked for a window of time and a
 * bound in rows is not one it could hold to. The pattern comes from the shared API constants so
 * readers with another validator refuse the same values this schema does.
 */
const MAX_LOG_TIMERANGE_LENGTH = 5;

export const LogTimerangeSchema = Type.String({
  description: 'How far back a log read starts, as a duration such as 30s, 5m or 2h.',
  pattern: LOG_TIMERANGE_PATTERN,
  maxLength: MAX_LOG_TIMERANGE_LENGTH,
});

export type LogTimerange = typeof LogTimerangeSchema.static;
