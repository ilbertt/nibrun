# @repo/internal-scripts

Scripts the repo runs outside the apps — CI steps, deploys, maintenance. Add
one here instead of writing a shell script.

- One script file in `src/` = one entry in `package.json`'s `scripts`, named after
  the file.
- Anything shared between scripts lives in `src/shared/`.
- Invoke from anywhere in the repo:
  `bun run --filter @repo/internal-scripts <script>`.

`measure-client-js <absolute-client-build-directory>` reports raw, gzip and Brotli
bytes for all emitted JavaScript and the unique scripts/preloads linked from
`index.html`. Compression uses Node zlib defaults on each file separately. The
HTML-linked set excludes route chunks loaded later; it is not a browser network
trace. Exclude server output by passing `dist/client` for the public site.
