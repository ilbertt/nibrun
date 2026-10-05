# @repo/api-client

The boundary for callers outside the API and agent. The public Treaty client imports only
`PublicApp` from `@repo/api/types`; its runtime must not import API or protocol implementation.
The internal client remains the agent's typed HTTP transport.

`src/models.ts` derives public request and response types from `PublicApiClient` with
`Treaty.Data`, `Parameters` and field access. Never import or restate API model types here.
Consumers, including tests, use these derived types instead of importing API or protocol files.

Runtime validation and configuration are generated into `src/public-contract.gen.ts` from
canonical API definitions by `bun run generate:contract`. Only the generator may read API
and protocol implementation files. Never edit the generated file; `check:types` verifies it
is current. Preserve TypeBox schema kinds when serializing: treating a schema as an unknown
kind would silently disable its validation.

`src/validation.ts` exposes client validators, `src/configuration.ts` exposes configuration
metadata, and `src/seen-tenant-logs.ts` deduplicates a reader's overlapping log streams.
These modules must remain safe to import in a browser without server setup or side effects.
