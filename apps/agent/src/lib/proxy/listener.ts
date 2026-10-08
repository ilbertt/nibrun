import { type HostPort, HostPortSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Data } from 'effect';
import { SLOT_COUNT } from '#lib/network/slot.ts';

// The waiting range follows the forwarded slot range and is never covered by its DNAT rules.
export function waitingPort(hostPort: HostPort): HostPort {
  return Value.Parse(HostPortSchema, hostPort + SLOT_COUNT);
}

export class AppListenerFailed extends Data.TaggedError('AppListenerFailed')<{
  readonly hostPort: HostPort;
  readonly cause: unknown;
}> {
  override get message() {
    return `The app's request listeners could not bind on port ${this.hostPort}.`;
  }
}
