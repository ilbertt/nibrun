import { Type } from '@sinclair/typebox';
import { HostDesiredStateSchema } from '#control/desired-state.ts';

const MIN_WAIT_SECONDS = 0;
const MAX_WAIT_SECONDS = 300;

/**
 * The protocol's own version, sent on every request.
 *
 * The agent and the control plane are deployed by different pipelines, so they are out of sync
 * during every rollout. This is what lets the older side say so, instead of failing somewhere
 * further in where the cause is no longer visible.
 */
export const PROTOCOL_VERSION = 1;

export const PROTOCOL_VERSION_HEADER = 'x-nibrun-protocol-version';

// Under /internal, not /api: the public edge answers 404 for that whole
// namespace, so an agent route is unreachable from the internet the moment it is
// written rather than once somebody remembers to protect it. Agents reach it
// over the private network instead.
export const AGENT_API_PREFIX = '/internal/agent';

// Every route is a POST carrying JSON, including the two that read. A long poll is not a
// cacheable GET, and a request body keeps the protocol to exactly one wire format and one
// validation path rather than adding query-string coercion at the only edge that would need it.
export const AGENT_ROUTES = {
  session: '/session',
  desiredState: '/desired-state',
  reportedState: '/reported-state',
} as const;

export const DesiredStateRequestSchema = Type.Object({
  knownGeneration: Type.Integer({ minimum: 0 }),
  waitSeconds: Type.Integer({ minimum: MIN_WAIT_SECONDS, maximum: MAX_WAIT_SECONDS }),
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

// Answered with the generation current at the time of the report, so an agent that has fallen
// behind learns it from the reply it was already making rather than from the next poll.
export const ReportedStateResponseSchema = Type.Object({
  generation: Type.Integer({ minimum: 0 }),
});

export type ReportedStateResponse = typeof ReportedStateResponseSchema.static;
