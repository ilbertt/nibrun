# SQLite explorer

- Reuse LibreDB’s `StudioWorkspace`; keep this package limited to connection, adapter and theme code.
- Keep tokens in memory, outside workspace props and browser storage. Queries run in the browser.
- Relay database errors. Execute editor SQL unchanged and without pagination; page only table previews.
- Import package CSS into the host’s Tailwind stylesheet after its theme.
- Bundle Monaco with Vite and configure its loader after importing LibreDB. Hosts must define `process.env.NEXT_PUBLIC_BASE_PATH` and `process.env.NEXT_PUBLIC_MONACO_VS_PATH` as empty strings.
