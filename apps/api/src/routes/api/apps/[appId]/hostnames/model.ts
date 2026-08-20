import { HostnameSchema } from '@repo/protocol';
import { t } from 'elysia';

// A hostname, not a URL: a scheme or a path here would be a request about something this cannot
// route, and the schema is what says so rather than a parser that quietly drops them.
export const AddHostnameRequestSchema = t.Object(
  { hostname: HostnameSchema },
  { additionalProperties: false },
);

// The hostname to stop serving, in the URL rather than a body: DELETE content has no defined
// semantics and some intermediaries drop it, and a removal that named its target only in the body
// would read the same as every other one in an access log.
export const RemoveHostnameQuerySchema = t.Object(
  { hostname: HostnameSchema },
  { additionalProperties: false },
);
