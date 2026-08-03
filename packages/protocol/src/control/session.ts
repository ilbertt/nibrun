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
 * Opens a session from a bootstrap credential delivered with the machine.
 *
 * The credential identifies the machine, not a user, and buys exactly one thing: a session
 * token. Everything afterwards presents the session, so revoking a host is expiring a session
 * rather than rotating a credential baked into an instance.
 */
export const AgentSessionRequestSchema = Type.Object({
  bootstrapToken: SecretStringSchema,
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
