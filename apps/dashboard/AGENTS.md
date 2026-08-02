# @repo/dashboard

The dashboard SPA. `@repo/api` serves it in production and Vite proxies `/api`
to the api in development, so it is same-origin either way.

## Components

One component per file, named after the component it exports —
`sign-out-button.tsx` exports `SignOutButton`. Shared components live in
`src/components/`; a route file holds the one component that route mounts, always
named `RouteComponent`, so every route reads the same way.

A component should read as markup. Push queries, mutations, derived state and
effects into a hook, and split anything that owns state or behaviour of its own
into its own component.

Reach for a hook before a prop: state a component can read for itself does not
belong in its signature, and nothing should be threaded through a component that
does not use it. Keep a prop for what the parent genuinely decides about the
child.

## Hooks

`src/lib/hooks/` holds one hook per file, the file named after the hook it
exports — `use-session.ts` exports `useSession`.

- Declare a hook with `function`, never `const`.
- Always annotate the return type. Left inferred, a hook leaks whichever library
  type it happens to wrap into every caller.
