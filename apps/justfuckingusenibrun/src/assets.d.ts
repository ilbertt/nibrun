// `with { type: 'file' }` embeds the asset and yields its path, but the loader attribute is not
// what the types key off: bun-types resolves any `.html` to an HTMLBundle, and knows no `.svg`.

declare module '#index.html' {
  const path: string;
  export default path;
}

declare module '#favicon.svg' {
  const path: string;
  export default path;
}
