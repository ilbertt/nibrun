# @repo/api-client

Typed HTTP transport for callers outside the API. Its public Treaty client imports only
`PublicApp` from `@repo/api/types`; the internal client is the agent's HTTP transport.
Runtime code must not import API or protocol implementation. Biome enforces this boundary.

`src/models.ts` derives request and response types from the exported Treaty client using
`Treaty.Data`, `Parameters`, and field access. Never restate API types, schemas, enum lists,
or policy here, and never generate a separate client contract. If Treaty loses information,
fix the API route model. Public models expose JSON primitives, leaving brands inside the API.

The API validates requests and exposes any defaults or metadata consumers need through HTTP
responses. Consumers own presentation, input syntax, and operation orchestration.
