# @repo/dashboard

The dashboard SPA. `@repo/api` serves it in production and Vite proxies `/api`
to the api in development, so it is same-origin either way.

## Components

`src/components/` holds one component per file, the file named after the
component it exports — `sign-out-button.tsx` exports `SignOutButton`.

Keep a component as small as it can be. Anything with its own state or behaviour
is its own component, not a branch of its parent: `AppHeader` lays out the header
and delegates the button to `SignOutButton`, which owns the sign-out itself.

A file under `src/routes/` is the exception, and only that: it pairs a route with
the component that route mounts.

## Hooks

`src/lib/hooks/` holds one hook per file, the file named after the hook it
exports — `use-session.ts` exports `useSession`.

- Declare a hook with `function`, never `const`.
- Always annotate the return type. Left inferred, a hook leaks whichever library
  type it happens to wrap into every caller.
