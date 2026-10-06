# @repo/sqlite

Shared SQLite wire schemas, resource limits, and Hrana request processing for the
API and host agent. Batch execution, stream lifecycle, and pipeline handling live
here; app ownership, deployment selection, and HTTP authentication stay in the API.
This package does not depend on `@repo/protocol`, either app, a SQL client at
runtime, or a web framework. Deployment routing and agent query envelopes belong
in `@repo/protocol`.

Package test executors stay private in `tests/support/`. API tests own their
connection lifecycle stubs. The libSQL client is a test-only dependency for
protocol conformance.

Schemas use TypeBox directly; types derive from schemas. `src/hrana-v2.ts`
manually adapts the upstream Hrana v2 HTTP declarations. The pinned commit and
source files are linked there and in `vendor/hrana-v2/README.md`; preserve the
MIT license beside that document. Update the copy manually and record its provenance.
`src/hrana.ts` applies resource limits without changing wire fields or tags.
