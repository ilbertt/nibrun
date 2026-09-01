// Bun's own remedy for asset imports: bun-types claims `*.html` for the bundler, but ships no
// `*.svg` at all, and no import attribute can tell TypeScript otherwise.

declare module '*.svg' {
  const path: string;
  export default path;
}
