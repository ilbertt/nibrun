# @repo/api-constants

Shared static API defaults and query syntax constants used by the API and its clients. Each value is declared once here;
consumers import it instead of copying a literal or fetching a configuration endpoint.

Keep this package free of schemas, request/response types, validation functions, transports and application
imports. Public request and response types still derive from `@repo/api-client`'s Treaty client.
API-only health, restart and business policy defaults stay in `apps/api/src/lib/`.
Runtime-reference names, metadata and interpolation belong to `@repo/protocol/runtime-values`.

Log timerange defaults and pattern text live in `src/log-query.ts`; API schemas and CLI option
validation use them directly. Do not duplicate this grammar or expose a configuration endpoint.

API key header and app permission naming live in `src/auth.ts`; authentication plugins and clients use the same constants.
