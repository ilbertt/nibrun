# SQLite explorer

- Reuse LibreDB’s `StudioWorkspace`; keep connection forms and app navigation in the host.
- Keep tokens in memory, outside workspace props and browser storage. Queries run in the browser.
- Relay database errors. Execute editor SQL unchanged and without pagination; page only table previews.
- Import package CSS into the host’s Tailwind stylesheet after its theme.
- Bundle Monaco with Vite and configure its loader after importing LibreDB. Hosts must define `process.env.NEXT_PUBLIC_BASE_PATH` and `process.env.NEXT_PUBLIC_MONACO_VS_PATH` as empty strings.
- The Bun patch adds FK navigation to LibreDB’s ESM workspace. Recheck it when upgrading LibreDB; composite/ambiguous constraints and blob keys are excluded from this prototype.
