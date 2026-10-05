# @repo/app-operations

Public operations shared by the dashboard and CLI. The API is reached only through
`@repo/api-client/public` and its exported Treaty client.

All request and response types derive from that client, either locally or through
`@repo/api-client/models`. Never import `@repo/api`, `@repo/protocol`, or either package's
implementation files, including in tests. Biome enforces this boundary.

Keep presentation, input syntax, log deduplication, and upload orchestration here. API validation,
business policy, defaults, and persistence stay in the API. Metadata comes from API responses,
not imported schemas or generated snapshots.
