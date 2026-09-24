/**
 * A markdown file imported for its text rather than rendered.
 *
 * `?raw` is the one spelling both runtimes this package is read by agree on: Bun serves the file
 * as text, and Vite's own raw suffix means the same thing. Bun's `.md` loader renders to HTML and
 * turns frontmatter into headings, which is not what a page's source is for.
 */
declare module '*.md?raw' {
  const content: string;
  export default content;
}
