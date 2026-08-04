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

// Every route is an outbound POST. Control messages carry one JSON document; tenantLogs carries
// an NDJSON stream on its own request so output backpressure can never delay desired state.
//
// tenantLogs is the one route whose response must not begin until the request body ends. The
// agent holds it open for as long as it has a host to report for, and answering on headers
// instead ends a stream the agent believes succeeded — which it would reconnect at the retry
// floor, forever, without ever calling it a failure.
export const AGENT_ROUTES = {
  session: '/session',
  desiredState: '/desired-state',
  reportedState: '/reported-state',
  tenantLogs: '/tenant-logs',
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
