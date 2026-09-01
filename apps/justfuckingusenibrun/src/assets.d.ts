// bun-types claims `*.html` for the bundler and ships no `*.svg` at all, and an import attribute
// tells TypeScript nothing — so the loader each import actually uses has to be declared here.

declare module '#index.html' {
  const path: string;
  export default path;
}

declare module '#favicon.svg' {
  const path: string;
  export default path;
}
