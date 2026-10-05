# @repo/protocol

**This package owns only communication between `apps/api` and `apps/agent`.** Two independently
deployed programs compile against it, so a change here is a change to both — and the two are out
of sync during every rollout, which is the case the schemas and `PROTOCOL_VERSION` are shaped
around.

## What belongs here

Before adding anything, name the API–agent message that carries it. Sharing code between the
two apps is not enough to put it here. Sharing it with the dashboard, CLI or website is not
enough either. Neither app may import the other app to share a definition; both ends of a
communication contract import it from this package.

- Session registration, session responses, protocol versioning, and internal route names.
- Desired-state requests/responses and reported-state messages.
- Filesystem and cron query requests, responses, and results.
- Tenant log messages produced by the agent and consumed by the API, including their stream
  vocabulary and cron run IDs. The log store transports these messages; it does not own their shape.
- Schemas, derived types, identifiers, state vocabularies, and bounds used by those messages.
- Small helpers required to define or validate those wire schemas, including brands and secret
  annotations. General application utilities belong to their owning app.

Operational work is expressed as desired state, never commands. Nothing here may be shaped
like `start(x)`. Filesystem and cron reads use separate query contracts because a read is not
state an agent converges on and must not delay a stop.

The directory names describe how the contract is organized:

- `src/control/` defines the API–agent messages and transport metadata.
- `src/domain/` defines the values those messages carry. It is not a shared domain-model layer.
- `src/lib/` supports those wire definitions and their validation.
- `src/index.ts` exports the contract; it must not become an application utility barrel.

## What belongs elsewhere

| Concern | Owner |
| --- | --- |
| Public API resource models, owner IDs, app names, app/deployment lifecycle states | `apps/api/src/domain/` |
| DNS record schemas and construction | `apps/api/src/domain/` |
| Configuration defaults, runtime reference descriptions, and owner-only input schemas | `apps/api/src/domain/` |
| API business policy and domain verification | `apps/api/src/lib/` and `apps/api/src/services/` |
| Log queries, log source filters, and log deduplication | `apps/api/src/domain/` |
| Log-store publishing and stream indexing, guest protocols, cron registrations, crontab parsing, and persisted cron tables | `apps/agent/src/lib/` |
| Reconciliation, cron dispatch, probe execution, and host mechanics | `apps/agent/src/lib/` and `apps/agent/src/services/` |

For example, `AppId` belongs here because messages identify an app; `OwnerId` belongs to the API
because the agent is never sent one. A returned `CronListing` belongs here; a persisted
`CronTable` belongs to the agent. A resource schema can describe a wire value here while the API
owns the default it chooses for that value.

A tenant log record is an agent-to-API message even though delivery passes through the log store.
Its shared schema belongs here; store clients, indexing choices, query defaults, and deduplication
do not. Log shipping uses its own path so a log burst cannot delay control traffic.

Environment values are carried to the agent and then interpreted by the guest. Their reference
names and validation belong to the wire contract; API descriptions and configuration-dependent
checks belong to the API. Moving ownership must not relax validation or duplicate that vocabulary.

**The agent must not depend on `@repo/api`, including `@repo/api/domain`, in source or tests.**
An import being pure or safe to bundle does not make an application dependency acceptable.
Protocol must not depend on either app, and API must not import agent implementation code.
Biome enforces the agent-to-API import boundary.

Only the API and agent depend directly on this package. Public consumers import
`@repo/api/domain`. The API reuses or derives from wire schemas when a public model carries the
same values; moving ownership must not duplicate field definitions, enums, or validation bounds.
Biome enforces the consumer boundary and prevents this package from importing another workspace
package.

## Constraints on a change

- **Schemas come from `@sinclair/typebox` directly, never from Elysia's `t`.** Same library, but
  importing it through Elysia would drag a web framework into a binary with no HTTP server in it.
  TypeBox is the only runtime dependency. This package must acquire no application dependencies,
  side effects, clients, storage access, or runtime-specific behavior.
- Types derive from schemas (`typeof XSchema.static`), state enums from one `const` array. Never
  hand-write a type a schema already describes.
- **Adding a value to a state enum decides the deploy order.** Unknown *properties* are tolerated
  (see `parseMessage`), but an unknown *value* in a known field fails the check and rejects the
  whole message — so one instance in a state the reader has not heard of loses that host's entire
  report, not just that instance. The side that reads the enum ships first: a new value on a
  report means the control plane before the agents, and one on desired state means the reverse.
- Absent means unknown or not applicable. **No field is ever `null`.** Owner environment patches
  belong to the public API and never travel to an agent.
