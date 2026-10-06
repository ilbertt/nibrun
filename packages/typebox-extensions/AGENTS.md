# @repo/typebox-extensions

Owns application-independent TypeBox schema construction helpers. `stringEnum` derives a
literal union schema and its static type from one readonly array.

Every export must extend TypeBox schema construction or inference. General TypeScript helpers,
application schemas, wire contracts, constants and runtime-reference semantics belong to their
owning packages. Do not turn this package into a TypeBox facade: import built-in TypeBox APIs
from `@sinclair/typebox` directly.

TypeBox is the only runtime dependency. No workspace dependencies, application imports,
side effects, clients or storage access are allowed. Biome enforces the workspace boundary.
