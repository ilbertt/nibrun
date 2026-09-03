import { Type } from '@sinclair/typebox';
import { HostCapacitySchema, HostVersionsSchema } from '#domain/host.ts';
import { HostIdSchema } from '#domain/identifiers.ts';
import { SecretStringSchema } from '#lib/secret.ts';
import { TimestampSchema } from '#lib/wire.ts';

const MIN_POLL_INTERVAL_MS = 100;

/**
 * How often the agent should come back. The control plane sets these rather than the agent, so
 * a fleet can be backed off without redeploying it — which is the whole of the rate control
 * while desired state is answered immediately.
 */
export const AgentPollSettingsSchema = Type.Object({
  // Floor between two desired-state requests, so a control plane answering instantly cannot be
  // hammered by its own fleet.
  minIntervalMs: Type.Integer({ minimum: MIN_POLL_INTERVAL_MS }),
  reportIntervalMs: Type.Integer({ minimum: MIN_POLL_INTERVAL_MS }),
});

export type AgentPollSettings = typeof AgentPollSettingsSchema.static;

/**
 * A quarter of a second, because this is what a deploy waits out before anything has begun.
 *
 * A change lands at no particular point in the interval, so what it costs on average is half of
 * one: at a second that was ~500ms on the front of every deploy, spent ahead of the artifact, the
 * boot and the guest — and against a deploy measured at 1.6s for a small binary, the largest
 * single thing the control plane was contributing.
 *
 * What a shorter one costs is polls, and the fleet is what decides whether that is dear rather
 * than this number. It is the control plane's to set for precisely that reason: it can be raised
 * again for every host at once without redeploying a single agent.
 *
 * Holding the request open is what stops notice-latency and request rate being the same dial at
 * all, and is the answer at the point where lowering this stops being cheap. It is not that point
 * while a host is something there is one of.
 */
const DEFAULT_MIN_INTERVAL_MS = 250;
const DEFAULT_REPORT_INTERVAL_MS = 15_000;

export const DEFAULT_AGENT_POLL_SETTINGS: AgentPollSettings = {
  minIntervalMs: DEFAULT_MIN_INTERVAL_MS,
  reportIntervalMs: DEFAULT_REPORT_INTERVAL_MS,
};

/**
 * Opens a session.
 *
 * There is deliberately no credential here. The internal port is reachable from inside the VPC
 * and nowhere else, and a tenant microVM is denied it by the host's own ruleset before it can
 * route anywhere — so a caller that reaches this endpoint has already crossed the boundary that
 * matters. The fleet-wide secret this used to carry was not a second boundary: it sat readable
 * on every host, so anything positioned to abuse the endpoint could read it, and rotating it
 * meant redeploying the fleet and the control plane together.
 *
 * What nothing here does yet is tell one host from another — `hostId` is honoured as presented.
 * That wants a claim a file cannot be copied into, such as an instance identity document, and
 * a shared secret every host already holds was never going to be it.
 */
export const AgentSessionRequestSchema = Type.Object({
  // Absent on a host's very first registration; the control plane assigns one and the agent
  // persists it, so a reinstalled agent rejoins as the same host rather than as a new one.
  hostId: Type.Optional(HostIdSchema),
  versions: HostVersionsSchema,
  capacity: HostCapacitySchema,
});

export type AgentSessionRequest = typeof AgentSessionRequestSchema.static;

export const AgentSessionSchema = Type.Object({
  hostId: HostIdSchema,
  sessionToken: SecretStringSchema,
  expiresAt: TimestampSchema,
  poll: AgentPollSettingsSchema,
});

export type AgentSession = typeof AgentSessionSchema.static;
