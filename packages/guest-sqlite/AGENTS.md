# guest-sqlite

The read-only SQLite reader linked into `infra/nibrunner-guest-image/init.c`. Nibrunner owns
PID 1, boot, tenant supervision, cron, filesystem operations and shutdown. This package only
provides the guest SQLite listener, jailed workers and Hrana adapter.

`bun run build` exports `dist/libnibrun-guest-sqlite.a` for Linux amd64. The image builder uses
the Docker `build` stage to link that archive into its wrapper. `versions.env` pins SQLite,
Jansson and the base image; Debian build packages may update between clean builds.

`bun run test` compiles and executes the SQLite unit/integration suites in Docker, then checks
the official libSQL HTTP client against the jailed Hrana server. No privileged container, block
device or mount is needed. AF_VSOCK and full nibrunner boot still require a hypervisor.

SQLite is the pinned official amalgamation from `versions.env`, checked by SHA-256 before compilation.
It links statically against musl, with extension loading omitted and temporary storage in memory.

`src/guest-sqlite.c` serves standard Hrana v2 HTTP on vsock port 51005. One keep-alive
connection owns one read-only database in a worker jailed to the data filesystem as the tenant uid.
HTTP bodies and JSON replies are bounded to 4 MiB, individual SQL/value fields to 64 KiB,
JSON depth to 32 and nodes to 16384. The listener permits four workers, each with a
16 MiB SQLite heap, a 128 MiB address-space ceiling, a five-second pipeline deadline and
a 30-second idle lease. SQLite sidecars stay within the jail and may not be symlinks.

Jansson 2.15.1 is the upstream MIT-licensed JSON parser, pinned by checksum in `versions.env`;
Hrana execution is our adapter over SQLite, not an upstream server implementation.
Upstream [sqld](https://github.com/tursodatabase/libsql/blob/d6c75af6353bb1c34985399608e37cd272a35aa1/libsql-server/src/connection/legacy.rs#L284)
opens managed namespace directories with read-write/create flags and its own WAL lifecycle,
which does not match exploration of arbitrary files concurrently owned by tenant applications.
The [Hrana specification](https://github.com/tursodatabase/libsql/blob/d6c75af6353bb1c34985399608e37cd272a35aa1/docs/HRANA_2_SPEC.md)
and maintained JSON parser avoid inventing another agent–guest SQL protocol.

On ARM Macs, `GUEST_SQLITE_TEST_PLATFORM=linux/arm64 bun run test` runs the Linux suites
natively. Rosetta cannot enforce the SQLite worker address-space limit reliably.
This test override does not change the production build target, which stays amd64.
