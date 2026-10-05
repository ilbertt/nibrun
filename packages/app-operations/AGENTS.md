# @repo/app-operations

Public operations shared by the dashboard and CLI. The API is reached only through
`@repo/api-client/public` and its exported Treaty client.

All request and response types derive from that client, either locally or through
`@repo/api-client/models`. Never import `@repo/api`, `@repo/protocol`, or either package's
implementation files, including in tests. Biome enforces this boundary.

Client validation and configuration come from api-client, where they are generated from API
definitions. Keep operations, user-facing formatting and upload orchestration here; API
validation, business policy and persistence stay in the API.
