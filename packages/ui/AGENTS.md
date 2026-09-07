# @repo/ui

The monorepo's shadcn components and theme. The **only** workspace with a
`components.json` — apps consume `@repo/ui` and never run shadcn themselves, so the
two apps cannot drift.

`components/` is what the CLI wrote, and editing it is allowed — that is the point of
shadcn, which distributes code rather than a dependency. Re-running `shadcn add` for a
component that is already here means a merge, which is a fair price: the CLI has been
run a handful of times in this project's life, and styling a component from a distance
costs more. Biome lints these files like any other.

Put a component's own look and behaviour in the component. `globals.css` holds what is
genuinely the theme — the palette, the radius, the type, and utilities more than one
component wears — and stops there. A rule in the stylesheet that reaches for a component
by the utility classes its variants happen to carry will break silently the day those
classes change, and cannot be turned off from a call site, which is how it ends up
growing data attributes nobody can find.

Anything hand-written still goes in `custom/`, where the CLI has no file to overwrite.

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
