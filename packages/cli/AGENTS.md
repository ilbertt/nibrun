# @repo/cli

`nib`, the CLI owners drive nibrun with. Built on [parsh](https://github.com/ilbertt/parsh):
the layout under `src/commands/` is the command tree.

- **Adding, renaming or moving a command means running `bun run generate`.** The
  generated `src/command-tree.gen.ts` is what types every handler's `ctx`, and it
  is committed. Editing an existing command's body does not need it.
- Keep top-level imports light — `--help` loads every command it lists, so pull
  the api client and anything else heavy in from inside the handler.
- `NIB_API_URL` and `NIB_API_KEY` are read through `@parshjs/env` as
  `ctx.context.env`, never `process.env`.
- Arguments meant for a tenant binary are split off `process.argv` at the first
  `--` in `src/main.ts` and reach handlers as `ctx.context.tenantArgs`.
- Run it with `bun nib …`. Bun runs package scripts from the repo root, so
  relative paths are resolved against the root rather than the caller's shell —
  pass absolute paths until the CLI ships as a real `bin`.
