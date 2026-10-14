# @repo/internal-scripts

Scripts the repo runs outside the apps — CI steps, deploys, maintenance. Add
one here instead of writing a shell script.

- One script file in `src/` = one entry in `package.json`'s `scripts`, named after
  the file.
- Anything shared between scripts lives in `src/shared/`.
- Invoke from anywhere in the repo:
  `bun run --filter @repo/internal-scripts <script>`.

`check-file-changes <path> [<path> ...]` checks repository-relative paths for
staged, unstaged, or untracked changes without staging them. It emits the
GitHub Actions output `changed` and, when changed, `source-commit` for the current
checkout. For example:
`bun run --filter @repo/internal-scripts check-file-changes packages/deploy-action/dist/index.mjs`.
