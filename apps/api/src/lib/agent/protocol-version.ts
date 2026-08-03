import { PROTOCOL_VERSION, PROTOCOL_VERSION_HEADER } from '@repo/protocol';
import { BadRequestError } from '#lib/errors.ts';

/**
 * The agent and the api ship in different pipelines, so version skew is the normal state during
 * every rollout rather than an edge case. Rejecting the message here is what turns it into a
 * refusal the older side can read, instead of a field misunderstood somewhere further in.
 */
export function assertProtocolVersion(headers: Record<string, string | undefined>): void {
  const spoken = headers[PROTOCOL_VERSION_HEADER];
  if (Number(spoken) !== PROTOCOL_VERSION) {
    throw new BadRequestError(
      `Agent speaks protocol ${spoken}, this control plane speaks ${PROTOCOL_VERSION}.`,
    );
  }
}
