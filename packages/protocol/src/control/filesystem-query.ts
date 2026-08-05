import { Type } from '@sinclair/typebox';
import { DirectoryListingSchema, GuestPathSchema } from '#domain/filesystem.ts';
import { AppIdSchema, FilesystemQueryIdSchema } from '#domain/identifiers.ts';

/**
 * A channel of its own, beside desired state rather than inside it.
 *
 * Desired state describes a world a host converges on, and a directory listing is not one: it has
 * an answer, it is wanted once, and nobody converges on it. Expressing it there would mint a
 * generation per click and make every host in the fleet re-read its own state because one person
 * opened a folder. Tenant output already took a separate path for the same kind of reason.
 *
 * The direction is unchanged, which is the point — the host still calls the control plane, and
 * the control plane still never connects to a host.
 */

const MAX_QUERY_MESSAGE_LENGTH = 512;

/**
 * What a host is willing to answer, restated on every poll rather than remembered by the control
 * plane. It is the host that knows which devices it has attached, so a query is offered to a host
 * that says it can serve the app rather than to one a stale table claims should be able to.
 */
const MAX_SERVED_APPS = 200;

export const FilesystemQueryRequestSchema = Type.Object({
  servedAppIds: Type.Array(AppIdSchema, { maxItems: MAX_SERVED_APPS }),
});

export type FilesystemQueryRequest = typeof FilesystemQueryRequestSchema.static;

export const FilesystemQuerySchema = Type.Object({
  queryId: FilesystemQueryIdSchema,
  appId: AppIdSchema,
  path: GuestPathSchema,
});

export type FilesystemQuery = typeof FilesystemQuerySchema.static;

/**
 * `none` is the common answer and carries nothing. Shaped as a union rather than an optional
 * field so that a host holding a query and a host holding nothing are different values, the way
 * `changed` and `unchanged` are on the desired-state poll.
 */
export const FilesystemQueryResponseSchema = Type.Union([
  Type.Object({ result: Type.Literal('none') }),
  Type.Object({ result: Type.Literal('query'), query: FilesystemQuerySchema }),
]);

export type FilesystemQueryResponse = typeof FilesystemQueryResponseSchema.static;

/**
 * Answered exactly once per `queryId`, including when it could not be answered: somebody is
 * holding a request open on the other end, so a host that stays quiet about a failure turns a
 * refusal into a timeout.
 */
export const FilesystemQueryResultSchema = Type.Object({
  queryId: FilesystemQueryIdSchema,
  outcome: Type.Union([
    Type.Object({ status: Type.Literal('listed'), listing: DirectoryListingSchema }),
    Type.Object({
      status: Type.Literal('failed'),
      message: Type.String({ maxLength: MAX_QUERY_MESSAGE_LENGTH }),
    }),
  ]),
});

export type FilesystemQueryResult = typeof FilesystemQueryResultSchema.static;
