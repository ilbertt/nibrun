import { PROTOCOL_VERSION_HEADER } from '@repo/protocol';
import { t } from 'elysia';

// Carried by every agent request, so it is declared once here rather than in each
// sibling route. Open to other headers: the protocol owns this one, not the rest.
export const ProtocolHeadersSchema = t.Object(
  { [PROTOCOL_VERSION_HEADER]: t.String() },
  { additionalProperties: true },
);
