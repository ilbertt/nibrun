# @repo/deploy-link

`src/presets.ts` owns the deploy catalog and its version, binary URL and checksum pins.
Keep preset maintenance in `scripts/update-presets.ts` and its helpers. Import the
catalog instead of maintaining a separate list of release sources or asset names.
Use TypeScript 7's `typescript/unstable/async` API and `typescript/unstable/ast`
for source parsing. Parse with an isolated virtual filesystem and close the native
compiler process in `finally`.

Run `bun run --filter @repo/deploy-link update:presets` from the repository root to
update the pins. The updater has no command-line options.
The script runs `bun fix:codestyle` after writing updates and exits with an error
if an upstream check or formatting fails.
Derive GitHub release repositories and asset names from the pinned binary URLs,
including forks. Drizzle Gateway uses its published Linux x64 download page.
Keep rolling presets without checksums unpinned; they already follow upstream builds.

The `update-deploy-presets` workflow runs daily at 06:23 UTC or on manual dispatch.
It uses the repository's `open-pr` action, with a branch derived from the target pins
so the same updates are proposed only once. It uses the built-in workflow token.
