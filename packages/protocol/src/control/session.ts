import { Type } from '@sinclair/typebox';
import { HostCapacitySchema, HostVersionsSchema } from '#domain/host.ts';
import { HostIdSchema } from '#domain/identifiers.ts';
import { SecretStringSchema } from '#lib/secret.ts';
import { TimestampSchema } from '#lib/wire.ts';

const MIN_POLL_WAIT_SECONDS = 1;
const MAX_POLL_WAIT_SECONDS = 300;
const MIN_POLL_INTERVAL_MS = 100;

/**
 * How often the agent should come back. The control plane sets these rather than the agent, so
 * a fleet can be backed off without redeploying it.
 */
export const AgentPollSettingsSchema = Type.Object({
  // How long the control plane will hold a desired-state request open before answering
  // `unchanged`.
  maxWaitSeconds: Type.Integer({
    minimum: MIN_POLL_WAIT_SECONDS,
    maximum: MAX_POLL_WAIT_SECONDS,
  }),
  // Floor between two desired-state requests, so a control plane answering instantly cannot be
  // hammered by its own fleet.
  minIntervalMs: Type.Integer({ minimum: MIN_POLL_INTERVAL_MS }),
  reportIntervalMs: Type.Integer({ minimum: MIN_POLL_INTERVAL_MS }),
});

export type AgentPollSettings = typeof AgentPollSettingsSchema.static;

const DEFAULT_MAX_WAIT_SECONDS = 30;
const DEFAULT_MIN_INTERVAL_MS = 1_000;
const DEFAULT_REPORT_INTERVAL_MS = 15_000;

export const DEFAULT_AGENT_POLL_SETTINGS: AgentPollSettings = {
  maxWaitSeconds: DEFAULT_MAX_WAIT_SECONDS,
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
