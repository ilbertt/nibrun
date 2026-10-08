Browser-only SQLite explorer. The package owns the connection form, libSQL transport, table pagination, query history, foreign-key navigation, and row details. It has no API or landing-page dependencies. SQL editor queries run unchanged; the database enforces access policy.

Import `SqliteExplorer` from `@repo/sqlite-explorer` and supply `className` for the container height and placement. `useSqliteExplorer` exposes the same state and actions for custom layouts. Tokens stay in component memory; disconnect clears connection and navigation state.

Import `@repo/sqlite-explorer/styles.css` into the host's Tailwind stylesheet after its theme. Styles use the shared UI theme variables; the package stylesheet registers its own Tailwind sources.

The LibreDB SQL editor loads Monaco from `/monaco/vs`. Call `copyMonacoAssets({ destination })` from `@repo/sqlite-explorer/monaco-assets` during the host build to copy the locally installed assets to that public directory. The bundler must define `process.env.NEXT_PUBLIC_BASE_PATH` as an empty string and `process.env.NEXT_PUBLIC_MONACO_VS_PATH` as `/monaco/vs` because LibreDB reads these Next.js variables in its browser bundle.

Run `bun run check:types` and `bun run test` in this package. This is an internal workspace package; npm packaging can be added when its public API is ready.
