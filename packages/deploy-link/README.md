# Deploy links and presets

`src/presets.ts` owns the deploy catalog and its version, binary URL and checksum pins.
`scripts/update-presets.ts` and its helpers maintain the pins by importing that catalog.

Run `bun run --filter @repo/deploy-link update:presets` from the repository root to
update the pins, or append `--check` to report updates without writing them.
GitHub releases are checked through the binary URL's repository, including forks;
Drizzle Gateway uses its published Linux x64 download page. Rolling presets without
checksums already follow upstream builds and remain unpinned.

The `update-deploy-presets` workflow runs daily at 06:23 UTC or on manual dispatch.
It uses the repository's `open-pr` action, with a branch derived from the target pins
so the same updates are proposed only once. It uses the built-in workflow token.
Failed upstream checks fail the workflow after successful updates have been proposed.
