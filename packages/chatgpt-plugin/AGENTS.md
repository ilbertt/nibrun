# @repo/chatgpt-plugin

Plugin metadata and ZIP packaging. Skills and icons are symlinks to the root `skills/`
and `brand/`; archives contain their bytes as regular files. Keep versions in `package.json`.

- `bun run --filter @repo/chatgpt-plugin build` creates the submission ZIP in `dist/`.
  Connect it through the Developer Portal's remote MCP flow. Directly importing a package
  with `mcp.json` makes it desktop-only, even when the endpoint is HTTPS.
- Add `--app-id <existing-app-id>` for a private web-testing ZIP that references an existing
  hosted app instead. It contains no MCP configuration and is not a public submission bundle.

Publisher/legal metadata and review materials still need completing before public submission.
