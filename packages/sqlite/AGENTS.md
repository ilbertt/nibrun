# @repo/sqlite

Shared SQLite wire schemas, resource limits, and Hrana pipeline relaying for the
API and host agent. Stream lifecycle and private guest baton translation live here;
SQL execution lives in the guest. App ownership, deployment selection, and HTTP
authentication stay in the API.
This package does not depend on `@repo/protocol`, either app, a SQL client at
runtime, or a web framework. Deployment routing and agent query envelopes belong
in `@repo/protocol`.

Package test sessions stay private in `tests/support/`. API tests own their
connection lifecycle stubs. Request and response body limits are defined in
`src/limits.ts` and apply to whole Hrana pipelines.

Schemas use TypeBox directly; types derive from schemas. `src/hrana-v2.ts`
manually adapts the upstream Hrana v2 HTTP declarations. The pinned commit and
source files are linked there and in `vendor/hrana-v2/README.md`; preserve the
MIT license beside that document. Update the copy manually and record its provenance.
`src/hrana.ts` applies resource limits without changing wire fields or tags.
