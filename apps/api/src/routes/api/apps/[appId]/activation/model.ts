import { AppSchema } from '@repo/protocol';
import { t } from 'elysia';

/**
 * An edit to how the app comes up, rather than the whole of it: `idleTimeoutMs` is read only for
 * an `on-request` app and kept for every app, so an owner turning the saving off has said nothing
 * about the timeout and gets it back when they turn it on again.
 *
 * Picked off the app rather than restated, which is what carries the floor on `idleTimeoutMs` here
 * as well — a timeout shorter than the cadence the host decides on is one it would accept and
 * could not keep, and this is where whoever typed it is still listening.
 *
 * Strict, like every other patch: without it a misspelled field is silently no request at all and
 * the caller is told 200.
 */
export const AppActivationRequestSchema = t.Partial(
  t.Pick(AppSchema, ['activation', 'idleTimeoutMs']),
  { additionalProperties: false },
);
