# @repo/app-operations

Public operations shared by the dashboard and CLI. The API is reached only through
`@repo/api-client/public` and its exported Treaty client.

All request and response types derive from that client, either locally or through
`@repo/api-client/models`. Never import API implementation or protocol schemas, including in
tests. Only the schema-free `@repo/protocol/runtime-values` subpath is public. Biome enforces
this boundary.

Keep presentation, input syntax, log deduplication, and upload orchestration here. API validation,
business policy, API-only defaults and persistence stay in the API. Shared static defaults live
in `@repo/api-constants`; runtime-reference construction comes from the schema-free
`@repo/protocol/runtime-values` subpath. Never copy either source here.
