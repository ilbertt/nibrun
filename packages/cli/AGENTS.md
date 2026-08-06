# @repo/cli

`nib`, the CLI owners drive nibrun with. Built on [parsh](https://github.com/ilbertt/parsh):
the layout under `src/commands/` is the command tree.

- **Adding, renaming or moving a command means running `bun run generate`.** The
  generated `src/command-tree.gen.ts` is what types every handler's `ctx`, and it
  is committed. Editing an existing command's body does not need it.
- `--help` loads every command it lists, so a heavy top-level import is paid on
  every help invocation. Not worth avoiding at this size; move imports into the
  handler once the tree is big enough to feel it.
- `NIBRUN_API_URL` and `NIBRUN_COOKIE_TOKEN` are read through `@parshjs/env`
  inside `createCli`'s context factory, never `process.env`. Handlers ask for
  the ready client as `ctx.context.api`.
- The session cookie is a placeholder for a credential the CLI has not been
  issued yet. It goes when better-auth's device-authorization and bearer
  plugins land: `nib login` will hold an access token and `authHeaders` will
  send `Authorization: Bearer` instead.
- The factory is where a missing variable is noticed, and parsh resolves it
  outside its own error handling — hence the `try` around `cli.main()`. Remove
  it and an unset variable prints a stack trace instead of one line.
- A tenant binary and its arguments arrive as one quoted positional, split by
  `src/lib/command-line.ts`. parsh cannot tell a trailing `--verbose` meant for
  the tenant from one meant for us, so quoting is what says which — never add a
  bare variadic and never reintroduce a `--` separator.
- Prompting is gated on both ends of the pipe being a terminal (`isInteractive()`)
  and on `--yes` being absent. A command must work with neither: whatever the
  flags left open still needs a default. `ctx.print` stays the plain-output path,
  clack the interactive one — see `src/lib/ui.ts`.
- Run it with `bun run --filter @repo/cli nib …`. A package script runs from the
  package directory, so relative paths resolve against `packages/cli` rather than
  the caller's shell — pass absolute ones until the CLI ships as a real `bin`.
