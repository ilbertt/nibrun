# @repo/dashboard

The dashboard SPA. `@repo/api` serves it in production and Vite proxies `/api`
to the api in development, so it is same-origin either way.

## Components

`src/components/` holds one component per file, named after the component it
exports — `github-sign-in-button.tsx` exports `GithubSignInButton`. Components
belonging to the same group live together in a subfolder of it.

`src/components/ui/` is the shadcn registry's output, kept as the CLI writes it
so `shadcn add` can overwrite a component without a merge. Biome skips it for
the same reason. Restyle from `src/styles.css`, not by editing these files.

`src/routes/` is the TanStack Router route tree, so its files are named for the
URL they serve rather than for what they export. Each holds the one component its
route mounts, always named `RouteComponent`, so every route reads the same way.

A `(group)/` directory contributes no URL segment; its `route.tsx` is the frame
the pages inside it share. `(dashboard)` is the signed-in chrome and `(auth)` the
standalone card, which is what decides that approving a terminal is not framed
like a page of the dashboard.

A component should read as markup. Push queries, mutations, derived state and
effects into a hook, and split anything that owns state or behaviour of its own
into its own component.

Reach for a hook before a prop: state a component can read for itself does not
belong in its signature, and nothing should be threaded through a component that
does not use it. Keep a prop for what the parent genuinely decides about the
child.

## Icons

`src/icons/` holds hand-written SVG icons, one per file, named after the
component it exports — `github-icon.tsx` exports `GithubIcon`. They sit outside
`src/components/` because they are artwork behind a React signature rather than
UI of their own.

Reach for `lucide-react` first and only add a file here for a glyph it does not
ship, such as a brand mark.

## Hooks

`src/lib/hooks/` holds one hook per file, the file named after the hook it
exports — `use-session.ts` exports `useSession`.

- Declare a hook with `function`, never `const`.
- Always annotate the return type. Left inferred, a hook leaks whichever library
  type it happens to wrap into every caller.
