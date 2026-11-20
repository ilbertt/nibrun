# agent

The control-plane bridge for nibrunner. One compiled binary on the nibrunner host registers
its durable identity, polls the API, stages artifacts and publishes desired state to nibrunner.
Nibrunner owns microVM lifecycle, networking, storage, wakeups and cron execution.

`src/index.ts` composes the platform and bridge layers. Services live in `src/services/`,
one `Effect.Service` per file; bridge mechanics live in `src/lib/`. Tests mirror source paths
under `tests/`, with shared fixtures in `tests/support/`.

Persist the registration identity before the first session request and reuse it on renewal.
Keep it unchanged when the API returns its canonical host id. A corrupt identity refuses
registration; silently replacing it would abandon the host's deployment ownership.
`AGENT_NIBRUNNER_STATE_DIR` defaults to `/var/lib/nibrunner`; `bridge/host-id` persists
registration separately from the engine's state.

Nibrunner desired-state, reported-state, filesystem response and tenant-log types are generated
from the release schemas pinned in `infra/nibrunner-host/versions.json`. Run
`bun run --filter @repo/internal-scripts generate-nibrunner-types` after changing that pin.
The type check rejects stale generated types; do not edit generated files by hand.

The raw binary store and packed-image cache retain digests for each app's current and previous
deployment. Running and idle instances, volume seeds and exports add protected references.
Cleanup shares a permit with staging and desired-file publication, requires a fresh accepted
report, and preserves open, mapped, hard-linked, recent, temporary, symlinked and unknown entries.
Missing retention metadata or incomplete process visibility disables reclamation. S3 objects
remain intact; evicted binaries are fetched and verified when needed.

Live filesystem and SQLite queries connect through nibrunner's deployment-bound guest API.
Nibrunner owns wakeup and idle protection. SQLite sessions serialize requests, preserve Hrana
values, bound concurrency and body sizes, and close on deployment changes or idle expiry.
Never retry SQL after a disconnect or uncertain result. The bridge supplies the current
accepted deployments when constructing the SQLite guest and session layers.

Every effectful path uses Effect with a typed error channel. Services declare their dependencies;
tests substitute them through the generated `make`. Scoped fibers and finalizers handle shutdown.
Stopping the bridge must not stop nibrunner or its guests.

Every failure is a `Data.TaggedError` with a safe message. Match on `_tag` rather than
`instanceof`. Host subprocesses run through `CommandRunner`; Bun's S3 client and hasher remain
direct because the platform has no equivalent.

**Never import `@repo/api`, including in tests.** Control-plane routes come from
`@repo/api-client/internal`; shared messages and validation come from `@repo/protocol`.
