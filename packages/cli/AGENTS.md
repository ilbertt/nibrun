# @repo/cli

`nib`, the CLI owners drive nibrun with. Built on [parsh](https://github.com/ilbertt/parsh):
the layout under `src/commands/` is the command tree.

- **Adding, renaming or moving a command means running `bun run generate`.** The
  generated `src/command-tree.gen.ts` is what types every handler's `ctx`, and it
  is committed. Editing an existing command's body does not need it.
- Keep top-level imports light — `--help` loads every command it lists, so pull
  the api client and anything else heavy in from inside the handler.
- `NIBRUN_API_URL` and `NIBRUN_API_KEY` are read through `@parshjs/env` as
  `ctx.context.env`, never `process.env`.
- Arguments meant for a tenant binary are split off `process.argv` at the first
  `--` in `src/main.ts` and reach handlers as `ctx.context.tenantArgs`.
- Prompting is gated on both ends of the pipe being a terminal (`isInteractive()`)
  and on `--yes` being absent. A command must work with neither: whatever the
  flags left open still needs a default. `ctx.print` stays the plain-output path,
  clack the interactive one — see `src/lib/ui.ts`.
- Run it with `bun run --filter @repo/cli nib …`. A package script runs from the
  package directory, so relative paths resolve against `packages/cli` rather than
  the caller's shell — pass absolute ones until the CLI ships as a real `bin`.
