# @repo/protocol

The contract between the control plane and the host agent. Two independently deployed programs
compile against it, so a change here is a change to both — and the two are out of sync during
every rollout, which is the case the schemas and `PROTOCOL_VERSION` are shaped around.

The model is desired state, never commands. Nothing here may be shaped like `start(x)`.

## Constraints on a change

- **Schemas come from `@sinclair/typebox` directly, never from Elysia's `t`.** Same library, but
  importing it through Elysia would drag a web framework into a binary with no HTTP server in it.
  TypeBox is the only dependency, and this package must acquire no side effects and no client.
- Types derive from schemas (`typeof XSchema.static`), state enums from one `const` array. Never
  hand-write a type a schema already describes.
- **Adding a value to a state enum decides the deploy order.** Unknown *properties* are tolerated
  (see `parseMessage`), but an unknown *value* in a known field fails the check and rejects the
  whole message — so one instance in a state the reader has not heard of loses that host's entire
  report, not just that instance. The side that reads the enum ships first: a new value on a
  report means the control plane before the agents, and one on desired state means the reverse.
- Absent means unknown or not applicable. **No field is ever `null`.** The one exception is
  `TenantEnvironmentPatchSchema`, which is an owner editing their app rather than anything a host
  is sent: there absent means "leave this variable as it is", so removing one needs a word of its
  own.
- **Log shipping, when it is built, gets its own path.** A log burst must never delay a stop.
