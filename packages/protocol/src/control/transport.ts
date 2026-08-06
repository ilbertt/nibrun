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
 * No `waitSeconds` yet, which is a deferral rather than a decision against long-polling. Holding
 * the request is what stops notice-latency and request rate being the same dial — `minIntervalMs`
 * is currently both, so buying a faster deploy means paying for it in polls from every host. What
 * it needs is something able to wake a held request, so it arrives with the `NOTIFY` beside the
 * write that changes desired state, and not before: until then it would register a waiter nothing
 * exists to notify.
 */
export const DesiredStateRequestSchema = Type.Object({});

export type DesiredStateRequest = typeof DesiredStateRequestSchema.static;

export const DesiredStateResponseSchema = HostDesiredStateSchema;

export type DesiredStateResponse = typeof DesiredStateResponseSchema.static;
