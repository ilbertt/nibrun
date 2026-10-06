# @repo/api-constants

Shared static API defaults used by the API and its clients. Each value is declared once here;
consumers import it instead of copying a literal or fetching a configuration endpoint.

Keep this package free of schemas, request/response types, validation, transports and application
imports. Public request and response types still derive from `@repo/api-client`'s Treaty client.
API-only health, restart and business policy defaults stay in `apps/api/src/lib/`.
Runtime-reference names, metadata and interpolation belong to `@repo/protocol/runtime-values`.
