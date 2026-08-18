# @repo/ui

The monorepo's shadcn components and theme. The **only** workspace with a
`components.json` — apps consume `@repo/ui` and never run shadcn themselves, so the
two apps cannot drift.

`components/` is the CLI's output, kept as it writes it so `shadcn add` can overwrite a
component without a merge. Biome skips it for the same reason. Restyle from
`src/styles/globals.css`, never by editing these files. Anything hand-written goes in
`custom/` instead, where the CLI can't reach it.

Files import each other through the package's own `@repo/ui/*` specifiers rather than
relative paths, because that is what `components.json` aims the CLI at — a regenerated
component writes those imports and would clobber anything else.

`globals.css` carries `@source` directives pointing back at `apps/` and `packages/`.
Tailwind v4 detects sources relative to the CSS file, so without them it would scan this
package alone and every utility class in the apps would silently vanish.

## Hooks

One hook per file, named after what it exports — `use-mobile.ts` exports `useIsMobile`.
Declare with `function`, never `const`, and always annotate the return type: left
inferred, a hook leaks whichever library type it happens to wrap into every caller.

Only hooks that are UI mechanics belong here. Anything that knows about the api or a
route stays in the app that owns it.
