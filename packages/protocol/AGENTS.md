# @repo/protocol

The domain model and the contract between the control plane and the host agent. Two
independently deployed programs compile against it, so a change here is a change to both.

Nothing in here talks to anything: no HTTP client, no side effects, no dependency but TypeBox.
The agent binary imports this package and must not acquire a web framework by doing so — which
is why schemas come from `@sinclair/typebox` directly and never from Elysia's `t`. They are the
same library; importing it through Elysia would drag the framework into a binary with no HTTP
server in it, for nothing.

Types derive from schemas (`typeof XSchema.static`) and state enums from one `const` array, so
they cannot drift. Never hand-write a type a schema already describes.

## Wire conventions

JSON and only JSON. **Absent means unknown or not applicable — no field is ever `null`.**
Timestamps carry a mandatory UTC offset, because a local time without one is what a lenient
parser silently turns into a wrong instant.

## Desired state, not commands

The control plane describes what a host should be running; the host describes what it is
running. Nothing is shaped like `start(x)`.

That is what makes agent restart, control-plane restart and a missed message all non-events:
the next poll re-reads the truth. A push model turns each of them into a delivery problem with
replay, dedup and ordering to solve. The reconciler is being designed the same way.

## Transport: long-polling HTTP, every route a POST

Two constraints decide it. The connection is always outbound from the host, so control traffic
never requires an inbound rule — a security requirement, not a preference. And the agent pulls
and converges rather than receiving commands.

Long polling meets both with the least machinery: nothing to reconnect, no channel liveness to
maintain, and no persistent connection tempting a push model. Reads are POSTs because a long
poll is not a cacheable GET, and one wire format means one validation path.

**Log shipping, when it is built, gets its own path.** A log burst must never delay a stop.

## Secrets

Redact before logging any message. `redactSecrets` is driven by the schema, so a secret field
added later is covered because it is *declared* secret — not because someone remembered to
extend a list of field names.
