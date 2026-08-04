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

export const PROTOCOL_VERSION_HEADER = 'x-nibrun-protocol-version';

// Under /internal, not /api: the public edge answers 404 for that whole
// namespace, so an agent route is unreachable from the internet the moment it is
// written rather than once somebody remembers to protect it. Agents reach it
// over the private network instead.
export const AGENT_API_PREFIX = '/internal/agent';

// Every route is a POST carrying JSON, including the two that read: a request body keeps the
// protocol to exactly one wire format and one validation path rather than adding query-string
// coercion at the only edge that would need it.
export const AGENT_ROUTES = {
  session: '/session',
  desiredState: '/desired-state',
  reportedState: '/reported-state',
} as const;

/**
 * What the host already has, so the control plane can answer `unchanged` rather than resend it.
 *
 * No `waitSeconds` yet, which is a deferral rather than a decision against long-polling. Holding
 * the request is what stops notice-latency and request rate being the same dial — `minIntervalMs`
 * is currently both, so buying a faster deploy means paying for it in polls from every host. What
 * it needs is something able to wake a held request, so it arrives with the `NOTIFY` beside the
 * write that changes desired state, and not before: until then it would register a waiter nothing
 * exists to notify.
 */
export const DesiredStateRequestSchema = Type.Object({
  knownGeneration: Type.Integer({ minimum: 0 }),
});

export type DesiredStateRequest = typeof DesiredStateRequestSchema.static;

export const DesiredStateResponseSchema = Type.Union([
  Type.Object({
    result: Type.Literal('changed'),
    state: HostDesiredStateSchema,
  }),
  Type.Object({
    result: Type.Literal('unchanged'),
    generation: Type.Integer({ minimum: 0 }),
  }),
]);

export type DesiredStateResponse = typeof DesiredStateResponseSchema.static;
