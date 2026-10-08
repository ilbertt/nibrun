# Deploy links and presets

`src/presets.ts` owns the deploy catalog and its version, binary URL and checksum pins.
Preset update tooling stays in this package and imports that catalog.

Run `bun run --filter @repo/deploy-link update:presets` from the repository root to
update the pins, or append `--check` to report updates without writing them.
GitHub releases are checked through the binary URL's repository, including forks;
Drizzle Gateway uses its published Linux x64 download page. Rolling presets without
checksums already follow upstream builds and remain unpinned.

The `update-deploy-presets` workflow runs daily at 06:23 UTC or on manual dispatch.
It creates or refreshes one PR. Configure `OPEN_PR_TOKEN` with a PAT or GitHub App
token so the resulting PR triggers the repository's required checks. Failed upstream
checks fail the workflow after successful updates have been proposed.
