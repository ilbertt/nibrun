# @repo/typebox-extensions

Owns application-independent TypeBox schema construction and static inference helpers. `stringEnum` derives a
literal union schema and its static type from one readonly array. `Brand` and `BrandedSchema`
own schema branding; `PublicValue` and `publicSchema` expose branded primitives as JSON types
without changing the runtime schema object, Kind or validation. Keep their brand identity in
one definition shared by schema authors and public type inference.

Every export must extend TypeBox schema construction or inference. General TypeScript helpers,
application schemas, wire contracts, constants and runtime-reference semantics belong to their
owning packages. Do not turn this package into a TypeBox facade: import built-in TypeBox APIs
from `@sinclair/typebox` directly.

TypeBox is the only runtime dependency. No workspace dependencies, application imports,
side effects, clients or storage access are allowed. Biome enforces the workspace boundary.
