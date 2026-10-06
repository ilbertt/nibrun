## Project

nibrun hosts a user-uploaded compiled binary in an isolated guest with a
persistent volume mounted at `data/`.

Bun + TypeScript monorepo (`apps/*`, `packages/*`).

## Stack

- **Runtime:** Bun
- **Monorepo:** Bun workspaces + Turbo
- **Linter/Formatter:** Biome (auto-formats on save)
- **Commits:** Conventional Commits (commitlint)

## Code style

- **Code must be self-explanatory — this is strict.** Express intent through
  naming, types, and structure, not prose. Do not write a comment that restates
  what the code already says. A comment is warranted only to explain a tradeoff,
  a non-obvious constraint, or a decision the reader cannot recover from the code
  (why, never what). If you feel the need to explain _what_ a block does, rename
  or extract it instead. Delete comments that no longer earn their place.
- Imports use `#*` subpath mapping (e.g. `import { foo } from '#services/foo'`)
- Single source of truth — never duplicate keys, enum values, or type info that belongs to a class/module; derive from the source instead
  DNS record names, type metadata, and required-record construction live in
  `apps/api/src/lib/dns-records.ts`. Consumers render the DNS records returned by the API;
  client fixtures describe those responses instead of reconstructing records from templates.
- Single source of truth is the golden rule: put each definition in the package that owns its
  meaning and derive every consumer from it. `@repo/protocol` owns API–agent messages, their wire
  schemas, and runtime-reference names, metadata and interpolation. Public consumers may import
  only its schema-free `@repo/protocol/runtime-values` subpath to construct those references;
  their API request and response types derive from the Treaty client in `@repo/api-client`.
  Shared static API defaults and query syntax constants belong to `@repo/api-constants`. API-only defaults, validation,
  business policy and helpers stay in `apps/api/src/lib/`; public resource schemas live in
  `apps/api/src/lib/api/`. Import their owning files directly; do not add API barrels or generate
  a second public contract. Moving shared constants does not justify adding an API endpoint.
  External consumers must not import `@repo/api`; only api-client may type-import its route types.
  Neither app imports the other app, including in tests. Guest mechanics and persistence models
  belong to `apps/agent/src/lib/`. Biome enforces these boundaries and prevents protocol
  dependencies on other workspace packages except `@repo/typebox-extensions`.
  Application-independent TypeBox schema construction, branding and public type inference
  belong to `@repo/typebox-extensions`; import them directly rather than re-exporting them
  through protocol. Do not use it for
  general TypeScript utilities or application schemas.
- Biome enforces `useMaxParams: 1` — wrap multiple params in an object
- Props are always passed — a component we wrote has no optional property. Declare
  `name: T | undefined` rather than `name?: T`, so a call site with nothing to pass says so.
  `biome-plugins/no-optional-props.grit` enforces it everywhere but `packages/ui/src/components`,
  which is shadcn's. It reads parameter lists and `*Props` type aliases, so a props type lifted
  out of the signature is named for what it is — anything else is unchecked.
- Biome caps cognitive complexity at 15 — extract a named function rather than silencing it
- Only re-export from index files - Biome enforces that
- Declare functions with `function`, never a `const` bound to an arrow. Applies
  to test fixtures and one-line helpers too. Biome's
  `useReactFunctionComponentDefinition` holds the line for components, except in
  `packages/ui/src/components`, which shadcn writes

## Validation

After finishing an implementation, always run:

1. `bun fix:codestyle` — auto-fix formatting/lint issues
2. `bun check:all` — verify types, codestyle and tests pass
3. `bun run build` — verify the build succeeds

Tests are `bun test` files, run through Turbo by `bun run test` — note `bun test` on its own is
Bun's own runner and bypasses the workspace. They live in a `tests/` directory sibling to `src/`,
never inside it — Biome fails any `src/**/*.test.*` that imports `bun:test`. `tests/` mirrors
`src/` (`apps/agent`) or the package's own layering (`apps/api`), and whatever more than one file
needs — fixtures, stubs, recorders — belongs in `tests/support/`, reached through the package's
`#tests/*` mapping. Not every package needs tests; a package whose correctness is only checkable
at runtime does.

The root's `build` is the one turbo script without `bun run --bun`: that flag symlinks `node`
to Bun for every descendant process, and miniflare — which `@repo/www` prerenders through —
crashes on teardown under Bun's `node:http`. CI installs a real Node from the root
`package.json`'s `engines.node`, so the www build finds one.

Check `package.json` scripts (root and per-app) for other available commands.

## Run scripts

When running a script, always check `package.json` scripts (root and per-app) for available commands first.

## READMEs

Packages fall in two buckets:

- **Published packages** (have a `pkg/` directory) carry **two** READMEs:
  - **`packages/<package>/pkg/README.md`** — public, user-facing. Ships to npm as part of `@<my-org>/<package>` (listed under `"files"` in `pkg/package.json`). This is what users see on the npm page. Covers install, usage, and public API. Must use the published name (`@<my-org>/...`), not the workspace name (`@repo/...`).
  - **`packages/<package>/README.md`** — internal contributor doc. Covers source layout, dev scripts, and constraints. **Must link to `pkg/README.md`** and **must not duplicate install/usage** — when in doubt, the public README wins and the internal one points to it.
- **Internal-only packages** (no `pkg/`) may not need a README at all. Add one only when there's contributor-relevant context that isn't obvious from the source.

When editing a published package, decide which audience the change is for and update only that file. If something belongs to both (e.g. a renamed export), update them in lockstep.

The root `README.md` is the project homepage: typically lists the public packages/apps and a quick-start. Keep it short — deep usage lives in each `pkg/README.md`.

## Keeping this file up to date

When a change affects code style, tooling, conventions, or project taste (new lint rules, formatter config, naming patterns, dependency choices, etc.), propose updating this file to reflect it.

## Pull requests

Keep PR descriptions minimal — the diff is self-explanatory, so don't enumerate every change. State the intent in a line or two.

Do not add a validation section for checks CI already runs. Include validation only when it is
specific to the PR and not covered by CI, such as a local manual run and its observed result.
