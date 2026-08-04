import { Type } from '@sinclair/typebox';
import { HostDesiredStateSchema } from '#control/desired-state.ts';

/**
 * The protocol's own version, sent on every request.
 *
 * The agent and the control plane are deployed by different pipelines, so they are out of sync
 * during every rollout. This is what lets the older side say so, instead of failing somewhere
 * further in where the cause is no longer visible.
 *
 * 2 dropped `waitSeconds`, `maxWaitSeconds` and the report's reply. A v1 agent requires the two
 * it no longer receives and reads a body that is no longer sent, so the skew has to be refused
 * here rather than surface as a validation error against a response that is merely newer.
 */
export const PROTOCOL_VERSION = 2;

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
 * There is deliberately no `waitSeconds`. A long poll needs something able to wake it, and
 * desired state is not yet read from anywhere that can change — a held request would register a
 * waiter nothing could ever notify, which is a slower answer bought with a sleeping connection.
 * It belongs here alongside the `LISTEN`/`NOTIFY` that makes a change observable, and not before.
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
