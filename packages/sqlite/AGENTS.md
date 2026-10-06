# @repo/sqlite

Shared SQLite wire schemas, resource limits, and resolved statements for the API
and host agent. This package does not depend on `@repo/protocol`, either app, a
SQL client, or a web framework. Deployment routing and agent query envelopes
belong in `@repo/protocol`.

Schemas use TypeBox directly; types derive from schemas. `src/hrana-v2.ts`
manually adapts the upstream Hrana v2 HTTP declarations. The pinned commit and
source files are linked there and in `vendor/hrana-v2/README.md`; preserve the
MIT license beside that document. Update the copy manually and record its provenance.
`src/hrana.ts` applies resource limits without changing wire fields or tags.
