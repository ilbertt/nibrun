# @repo/chatgpt-plugin

Plugin metadata and ZIP packaging. Skills and icons are symlinks to the root `skills/`
and `brand/`; archives contain their bytes as regular files. Keep versions in `package.json`.

`bun run --filter @repo/chatgpt-plugin build` creates the submission ZIP in `dist/`.
Connect it through the Developer Portal's remote MCP flow. Directly importing a package
with `mcp.json` makes it desktop-only, even when the endpoint is HTTPS.

Publisher/legal metadata and review materials still need completing before public submission.
