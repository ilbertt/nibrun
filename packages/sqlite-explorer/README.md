Browser-only integration of LibreDB's `StudioWorkspace`. LibreDB owns the object tree, query tabs, SQL editor, results grid, row details, history, charts and schema diagrams. This package supplies the connection form, libSQL transport, SQLite catalog adapter and nibrun theme. It has no API or landing-page dependencies.

Import `SqliteExplorer` and supply `className` for its height and placement. `useSqliteExplorer` manages connection lifecycle; `createSqliteWorkspace` exposes the adapter props for embedding LibreDB in another shell. Credentials stay in the adapter closure, never in workspace props or browser storage. Disconnect closes the client.

Import `@repo/sqlite-explorer/styles.css` into the host's Tailwind stylesheet after its theme. The stylesheet registers LibreDB's Tailwind sources and maps its colors to the host theme. Vite bundles Monaco and its worker when the workspace loads; no public asset-copy step is needed. Define `process.env.NEXT_PUBLIC_BASE_PATH` and `process.env.NEXT_PUBLIC_MONACO_VS_PATH` as empty strings because LibreDB reads them at module load.

SQL editor statements execute unchanged and without pagination; table previews honor LibreDB's explicit limit/offset options. Database errors are relayed without a local SQL permission check. LibreDB has its own destructive-query confirmation UI; the database remains responsible for enforcing read-only access.

Foreign-key metadata is supplied to LibreDB's schema diagrams. The published workspace currently has no result-cell renderer or FK-navigation callback, so clickable FK values require an upstream API change. This adapter does not reimplement those views.

Run `bun run check:types` and `bun run test` in this package. This is an internal workspace package; npm packaging can be added when its public API is ready.
