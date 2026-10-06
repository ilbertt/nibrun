# @repo/api-client

Typed HTTP transport for callers outside the API. Its public Treaty client imports only
`PublicApp` from `@repo/api/types`; the internal client is the agent's HTTP transport.
Runtime code must not import API or protocol implementation. Biome enforces this boundary.

`src/models.ts` derives request and response types from the exported Treaty client using
`Treaty.Data`, `Parameters`, and field access. Never restate API types, schemas, enum lists,
or policy here, and never generate a separate client contract. If Treaty loses information,
fix the API route model. Public models expose JSON primitives, leaving brands inside the API.

The API validates requests. Shared static defaults come from `@repo/api-constants`; clients that
construct runtime references use `@repo/protocol/runtime-values`. Neither belongs in a generated
client contract or a new configuration endpoint. Consumers own presentation, input syntax and
operation orchestration.
