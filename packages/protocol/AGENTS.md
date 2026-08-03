# @repo/protocol

The domain model and the contract between the control plane and the host agent. Everything
downstream compiles against it, so a change here is a change to two independently deployed
programs — treat it that way.

Nothing in here talks to anything. No HTTP client, no database, no side effects, no
dependency other than TypeBox. The agent binary imports this package and must not acquire a
web framework by doing so.

## Schemas

**TypeBox, imported from `@sinclair/typebox` directly — never `t` from `elysia`.** The repo
already has one schema idiom (Elysia's `t` *is* TypeBox), and a second one is what the
single-source-of-truth rule exists to prevent. Importing it through Elysia would drag the
whole framework into a binary that has no HTTP server in it; Elysia accepts plain TypeBox
schemas in routes regardless.

Every TypeScript type is derived from its schema (`typeof XSchema.static`), so the two cannot
drift. Never hand-write a type that a schema already describes.

State enums are declared once as a `const` array and turned into a schema by `stringEnum`, so
the schema, the type and anything that needs to iterate the states all come from that one
array.

## The wire format

JSON and only JSON. ISO strings for timestamps, hex for digests, numbers for sizes.
Conversion to richer types happens explicitly at the edge that wants them, never implicitly
in here.

Two rules that are easy to violate without noticing:

- **Timestamps carry a mandatory UTC offset.** A local time with no offset is the value a
  lenient parser silently turns into a wrong instant, so it is rejected. Calendar validity is
  not checked; that is not the failure this guards against.
- **Absent means unknown or not applicable. No field is ever `null`.** One convention, so
  nothing has to decide what the difference between the two would have meant.

## Desired state, not commands

The control plane describes what a host should be running; the host describes what it is
running. There is deliberately nothing shaped like `start(x)` or `stop(x)`.

This is what makes agent restart, control-plane restart and a missed message all non-events:
the next poll re-reads the truth. A push model would make each of those a delivery problem
with replay, dedup and ordering to solve. The reconciler is being designed the same way.

`HostDesiredState.instances` is authoritative — a microVM running on the host and absent from
that list is one the host stops. `volumes` and `checkpoints` are **not**: they hold tenant
data, so removal is only ever expressed by an explicit `absent`. A truncated response must not
be able to delete a filesystem.

`generation` increases whenever a host's desired state changes; the agent long-polls against
it and echoes it back as `observedGeneration`, which is how the control plane tells
"converged" from "has not read the new state yet".

## Transport

**Long-polling HTTP, every route a POST carrying JSON.**

Two constraints decide this. The connection is always outbound from the host, so nothing about
control traffic ever requires an inbound rule — that is a security requirement, not a
preference. And the agent pulls and converges rather than receiving commands.

Long polling satisfies both with the least machinery: the control plane is already an HTTP
service, there is no reconnect or heartbeat logic to write, and there is no channel whose
liveness has to be maintained. A WebSocket or a gRPC stream would satisfy the outbound
constraint equally well while adding a persistent connection to manage and, worse, tempting a
push model the reconciler is not designed for.

Reads are POSTs because a long poll is not a cacheable GET, and a request body keeps the
protocol to exactly one wire format and one validation path rather than adding query-string
coercion at the only edge that would need it.

**Log shipping, when it is built, must be a separate path.** Different volume, different
reliability needs, and a log burst must never be able to delay a stop. Nothing here should
grow a field that makes multiplexing the two tempting.

## Validation

Runtime validation at the boundary is not optional. The agent and the control plane are
deployed by different pipelines, so they are out of sync during every rollout — that is the
normal state, not an edge case, and validation is what turns version skew into a rejected
message instead of silently misinterpreted state.

`parseMessage` tolerates unknown properties and rejects missing or mistyped ones. Tolerating
unknowns is deliberate: during a rollout the newer side sends fields the older side has never
heard of, and rejecting those would make every deploy an outage.

## Branding

Identifiers and ports are branded, so passing an `AppId` where an `InstanceId` belongs, or a
`GuestPort` where a `HostPort` belongs, is a type error. The guest port is the one the user's
binary listens on inside its VM; the host port is the one the agent forwards to it and is
stable for the lifetime of the app. Conflating them is a routing bug that type-checks, which
is exactly why they are branded apart.

A brand is applied by intersecting a schema's type-level `static` property, never by
`Type.Unsafe` — that rewrites the schema's Kind, and a schema TypeBox no longer recognises is
one it validates nothing against. `src/protocol.test.ts` asserts that branded schemas still
reject malformed values, because that failure is silent.

## Secrets

Tenant environment variables are secrets. `SecretStringSchema` carries an annotation rather
than merely a name, so `redactSecrets` is driven by the schema: a secret field added later is
redacted because it is *declared* secret, not because someone remembered to extend a list of
field names somewhere else. Redact before logging any message.

`ProtocolValidationError` deliberately drops the offending value. TypeBox reports it on every
error, and tenant environment variables are among the things validated here.

`ReportedInstance.message` is operator-facing detail about why something is in the state it is
in. It is never the tenant's own output — that goes to the guest console, which systemd
captures into the host's journal.

## What the model has to get right

Each of these has a deferred feature behind it that becomes a migration if the shape is wrong:

- **An app has a set of hostnames, one marked default** — not "a subdomain". Custom domains
  are then a new entry rather than a schema change and a rewrite of every routing path.
- **Guest port and host port are different things**, and stay branded apart.
- **The agent reports the host-side port.** Routing is local to the host, so the control plane
  does not strictly need it — but it is required to debug a host nothing can connect to, and
  it is what a second app host would route on.
- **Cutting a filesystem checkpoint is expressible as desired state**, because export reads a
  tenant's filesystem while a host still has it open and only that host can produce a view
  that is not moving underneath the reader.

`DesiredInstance` carries its app's hostnames so the agent can render its local proxy config
from the same state it boots VMs with. That proxy is not built yet; the bookkeeping is shaped
so a config renderer can read it directly rather than only making sense to the boot path.
