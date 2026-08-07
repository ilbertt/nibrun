# @repo/cli

`nib`, the CLI owners drive nibrun with. Built on [parsh](https://github.com/ilbertt/parsh):
the layout under `src/commands/` is the command tree.

- **Adding, renaming or moving a command means running `bun run generate`.** The
  generated `src/command-tree.gen.ts` is what types every handler's `ctx`, and it
  is committed. Editing an existing command's body does not need it.
- `--help` loads every command it lists, so a heavy top-level import is paid on
  every help invocation. Not worth avoiding at this size; move imports into the
  handler once the tree is big enough to feel it.
- `NIBRUN_API_URL` is read through `@parshjs/env` inside `createCli`'s context
  factory, never `process.env`. Handlers ask for the ready client as
  `ctx.context.api`.
- `nib login` is the device-authorization flow: the CLI shows a code, the owner
  approves it on the dashboard's `/device`, and the token that comes back is
  written by `@parshjs/files` to `~/.config/nib/credentials.json`. It is stored
  with the api that issued it, because it authenticates against no other.
- A flag several commands share is declared once on their parent with
  `forwardToChildren: true` and read as `parents['<path>'].options`, never
  redeclared per child. The parent is then a group: no handler, so `nib apps`
  lists what is under it, and the flag stays optional — a required one would make
  that listing an error. parsh spells a flag exactly as its key, so `--app` is
  the key `'app'` — and a flag two unrelated commands both take is a
  `SharedOption` member in `src/config.ts`, so they cannot drift apart. When
  those commands also mean the same thing by it, the whole declaration is shared
  from there (`DEPLOYMENT_ID_OPTION`) and the site adds only
  `forwardToChildren`. `defineCommand` infers its options `const`, so an enum
  key and a spread both survive as literals — `parents['<path>'].options` stays
  typed either way.
- A positional is a path segment, so a command taking one lives at
  `commands/<…>/[name].ts` and its path string ends in `[name]`. Leaving it out
  prints the parent's usage rather than a missing-argument error, because the
  walk stops at the node above the param — that listing is the only place the
  command's description is read, so it has to say what the value is for.
- An **optional** positional is that node given a command of its own:
  `commands/apps/files/ls.ts` beside `commands/apps/files/ls/[path].ts` makes
  `nib apps files ls` and `nib apps files ls <path>` two commands, and the walk
  picks whichever the positional it was handed reaches. There is no other
  spelling — a param is how routing gets there, so a command reached without one
  is a different command. Flags they share go on the `ls` node with
  `forwardToChildren: true`.
- **`options` is required by `defineCommand` even when a command has none.**
  Omitting it matches the alias overload instead, whose errors talk about
  `undefined` and never mention options. `options: {}` is the fix.
- **The client is built even when there is no token**, so `nib login` — a
  command like any other — can run at all. What stops an unauthenticated
  request is `requireSignedIn` in a `beforeHandler`. A new command that talks to
  the api needs that line, or its failure is a bare 401.
- The factory is where a missing variable or unreadable credential is noticed,
  and parsh resolves it outside its own error handling — hence the `try` around
  `cli.main()`. Remove it and those print a stack trace instead of one line.
- A tenant binary and its arguments arrive as one quoted positional, split by
  `src/lib/command-line.ts`. parsh cannot tell a trailing `--verbose` meant for
  the tenant from one meant for us, so quoting is what says which — never add a
  bare variadic and never reintroduce a `--` separator.
- Prompting is gated on both ends of the pipe being a terminal
  (`isInteractive()`). A command must work without one: whatever the flags left
  open still needs a default. `ctx.print` stays the plain-output path, clack the
  interactive one — see `src/lib/ui.ts`.
- **A command under `apps` reached without `--app` asks which one**, through
  `selectApp` in `src/lib/apps.ts` so that the question is one question wherever
  it is asked. An app is not something that can be defaulted to, so without a
  terminal to ask at that is where the flag is demanded instead. `apps list` is
  the exception and the reason the rule is not enforced anywhere central: it
  lists the apps themselves, so asking which one would be circular.
- **A command that destroys something is the exception**, because the only
  default it could take is the destruction. Without a terminal it is refused
  rather than answered on the owner's behalf, so `--yes` is the one way to mean
  it from a script — and that is why `--yes` lives on such a command rather than
  anywhere shared. The terminal question is a typed phrase, not a y/n, which is
  answered by the muscle that answers every other one — see `src/lib/delete.ts`.
- Run it with `bun run --filter @repo/cli nib …`. A package script runs from the
  package directory, so relative paths resolve against `packages/cli` rather than
  the caller's shell — pass absolute ones until the CLI ships as a real `bin`.
