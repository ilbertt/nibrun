Browser-only SQLite explorer. The package owns the connection form, libSQL transport, table pagination, query history, foreign-key navigation, and row details. It has no API or landing-page dependencies. SQL editor queries run unchanged; the database enforces access policy.

Import `SqliteExplorer` from `@repo/sqlite-explorer` and supply `className` for the container height and placement. `useSqliteExplorer` exposes the same state and actions for custom layouts. Tokens stay in component memory; disconnect clears connection and navigation state.

Import `@repo/sqlite-explorer/styles.css` into the host's Tailwind stylesheet after its theme. Styles use the shared UI theme variables; the package stylesheet registers its own Tailwind sources.

The SQL editor bundles Monaco's ESM API, SQL language and editor worker through Vite. Its setup is loaded only when the SQL editor opens, after LibreDB configures the shared Monaco loader. The host does not need an asset-copy step or a public Monaco directory.

LibreDB still reads Next.js environment variables at module load. Define `process.env.NEXT_PUBLIC_BASE_PATH` and `process.env.NEXT_PUBLIC_MONACO_VS_PATH` as empty strings in the host bundler. The injected Monaco instance bypasses the URL-based loader. This follows [Monaco React's Vite integration](https://github.com/suren-atoyan/monaco-react#use-monaco-editor-as-an-npm-package).

Run `bun run check:types` and `bun run test` in this package. This is an internal workspace package; npm packaging can be added when its public API is ready.
