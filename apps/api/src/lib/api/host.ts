import {
  HostCapacitySchema,
  HostIdSchema,
  HostVersionsSchema,
  HostStateSchema as ReportedHostStateSchema,
  TimestampSchema,
} from '@repo/protocol';
import { Type } from '@sinclair/typebox';

export const HostStateSchema = Type.Union([ReportedHostStateSchema, Type.Literal('retired')]);
export type HostState = typeof HostStateSchema.static;

export const HostSchema = Type.Object({
  id: HostIdSchema,
  state: HostStateSchema,
  capacity: HostCapacitySchema,
  allocatable: HostCapacitySchema,
  versions: HostVersionsSchema,
  registeredAt: TimestampSchema,
  lastSeenAt: TimestampSchema,
  retiredAt: Type.Union([TimestampSchema, Type.Null()]),
});

export type Host = typeof HostSchema.static;
