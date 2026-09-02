import { Type } from '@sinclair/typebox';
import { HostDesiredStateSchema } from '#control/desired-state.ts';

/**
 * The protocol's own version, sent on every request.
 *
 * The agent and the control plane are deployed by different pipelines, so they are out of sync
 * during every rollout. This is what lets the older side say so, instead of failing somewhere
 * further in where the cause is no longer visible.
 *
 * Still 1 while the first version is being shaped. Both sides ship from this repo and nothing
 * outside it speaks this protocol, so a break is a deploy rather than a migration, and bumping
 * on each one would only turn this into a changelog of churn. It starts moving when something
 * we do not deploy depends on the shape.
 */
export const PROTOCOL_VERSION = 1;

/**
 * The range a host may ask to be held for. The ceiling is not the control plane's own — that one
 * is lower and belongs where the thing closing the connection is known — it is only the widest
 * request that is worth writing down rather than reading as a mistake.
 */
const MIN_HOLD_SECONDS = 1;
const MAX_HOLD_SECONDS = 60;

export const PROTOCOL_VERSION_HEADER = 'x-nibrun-protocol-version';

// Under /internal, not /api: the public edge answers 404 for that whole
// namespace, so an agent route is unreachable from the internet the moment it is
// written rather than once somebody remembers to protect it. Agents reach it
// over the private network instead.
export const AGENT_API_PREFIX = '/internal/agent';

// Every route is an outbound POST carrying one JSON document, including the two that read: a
// request body keeps them to exactly one wire format and one validation path rather than adding
// query-string coercion at the only edge that would need it.
//
// Tenant output is not among them. It goes from the agent to the log store directly, on a port of
// its own, so a host's log volume can never delay the desired state it is waiting on.
export const AGENT_ROUTES = {
  session: '/session',
  desiredState: '/desired-state',
  reportedState: '/reported-state',
  // A question and its answer, on a channel of their own: a read is not a state anything
  // converges on, so it must not be able to disturb one.
  filesystemQuery: '/filesystem-query',
  filesystemQueryResult: '/filesystem-query-result',
} as const;

/**
 * Nothing, and deliberately: a host asking what it should be running has nothing to tell the
 * control plane to get an answer.
 *
 * It used to carry what the host already had, so the reply could be `unchanged` instead of the
 * state. Deciding that costs the control plane a read of everything the state is made of, which
 * is what it was trying not to send — and the host holds the last state anyway, so it can see
 * for itself whether the one that arrived differs. The comparison belongs to the only party that
 * knows what it converged on.
 *
 * `waitSeconds` is what stops notice-latency and request rate being the same dial. Without it
 * `minIntervalMs` is both, so a deploy noticed sooner is paid for in polls from every host; with
 * it a host asks once and is answered the moment there is something to say.
 */
export const DesiredStateRequestSchema = Type.Object({
  /**
   * How long the control plane may hold this open with nothing to say, or absent to be answered
   * at once.
   *
   * Optional because that absence is the whole of the rollout. An agent that predates this sends
   * nothing and is answered immediately, exactly as it is today, so the api may go out first the
   * way it has to; and an agent asking a control plane that predates it has the field ignored and
   * falls back to the same. Neither half has to know what the other is running.
   *
   * The control plane holds it for less where its own ceiling is lower — a request held past what
   * closes it from outside comes back as an error, and an error is something a host backs off
   * from rather than reopens.
   */
  waitSeconds: Type.Optional(
    Type.Integer({ minimum: MIN_HOLD_SECONDS, maximum: MAX_HOLD_SECONDS }),
  ),
});

export type DesiredStateRequest = typeof DesiredStateRequestSchema.static;

export const DesiredStateResponseSchema = HostDesiredStateSchema;

export type DesiredStateResponse = typeof DesiredStateResponseSchema.static;
