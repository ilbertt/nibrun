import {
  HostCapacitySchema,
  HostIdSchema,
  HostStateSchema,
  HostVersionsSchema,
  TimestampSchema,
} from '@repo/protocol';
import { Type } from '@sinclair/typebox';

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
