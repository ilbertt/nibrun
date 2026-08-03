import { Type } from '@sinclair/typebox';
import { HostIdSchema } from '#domain/identifiers.ts';
import { stringEnum } from '#lib/string-enum.ts';
import { ByteSizeSchema, TimestampSchema } from '#lib/wire.ts';

const MAX_VERSION_LENGTH = 128;

const VersionSchema = Type.String({ minLength: 1, maxLength: MAX_VERSION_LENGTH });

// Answering "what is this host running" from the host itself, so it can be compared against
// what git says it should be running. The agent's version is a git SHA; everything else is
// the version named in the committed pin file.
export const HostVersionsSchema = Type.Object({
  agent: VersionSchema,
  guestImage: VersionSchema,
  zerofs: VersionSchema,
  firecracker: VersionSchema,
});

export type HostVersions = typeof HostVersionsSchema.static;

export const HostCapacitySchema = Type.Object({
  vcpuCount: Type.Integer({ minimum: 0 }),
  memoryMib: Type.Integer({ minimum: 0 }),
  cacheBytes: ByteSizeSchema,
});

export type HostCapacity = typeof HostCapacitySchema.static;

export const HOST_STATES = ['registering', 'ready', 'draining', 'unreachable'] as const;

export const HostStateSchema = stringEnum(HOST_STATES);

export type HostState = typeof HostStateSchema.static;

export const HostSchema = Type.Object({
  id: HostIdSchema,
  state: HostStateSchema,
  capacity: HostCapacitySchema,
  allocatable: HostCapacitySchema,
  versions: HostVersionsSchema,
  registeredAt: TimestampSchema,
  lastSeenAt: TimestampSchema,
});

export type Host = typeof HostSchema.static;
