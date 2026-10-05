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
- `src/schemas/` defines the values those messages carry, with types derived from each schema.
- `src/lib/` supports those wire definitions and their validation.
- `src/index.ts` exports the contract; it must not become an application utility barrel.

## What belongs elsewhere

| Concern | Owner |
| --- | --- |
| Public API resource schemas, owner IDs, app names, app/deployment lifecycle states | `apps/api/src/lib/api/` |
| DNS record schemas and construction | `apps/api/src/lib/dns-records.ts` |
| Configuration defaults and runtime reference descriptions | `apps/api/src/lib/` |
| Owner-only input schemas and log query schemas | `apps/api/src/lib/api/` |
| API business policy and domain verification | `apps/api/src/lib/` and `apps/api/src/services/` |
| Log deduplication | `apps/api/src/lib/seen-tenant-logs.ts` |
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

**The agent must not depend on `@repo/api`, including every API subpath, in source or tests.**
An import being pure or safe to bundle does not make an application dependency acceptable.
Protocol must not depend on either app, and API must not import agent implementation code.
Biome enforces the agent-to-API import boundary.

Public consumers must use `@repo/api-client`, deriving request and response types from its
exported Treaty client. They may not import API or protocol implementation files, including in
tests. Client runtime validation and configuration are generated from the API's definitions,
not redefined in protocol. The api-client generator may read wire definitions used by public
routes; its runtime source must not import this package or API implementation code.
Do not duplicate field definitions, enums or bounds, and do not add an API schema/helper barrel.
Biome enforces the public consumer boundary and prevents protocol dependencies on another workspace package.

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
