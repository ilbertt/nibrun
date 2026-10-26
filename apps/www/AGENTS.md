# @repo/www

The public marketing site is prerendered by TanStack Start and served by Cloudflare
static assets. Keep indexable content, links, and metadata in the initial HTML.

- Every public page declares one absolute canonical through `pageHead`.
- `scripts/sitemap.ts` derives sitemap URLs from the prerendered pages and fails
  the build if their canonical URLs disagree with their paths. Keep the standard
  sitemap namespace and omit `lastmod` until actual content modification dates
  are available; deployment dates are not content modification dates.
- Markdown responses point to their HTML equivalents with an HTTP canonical link.
  Deploy redirects and dashboard screens are outside the public search index.
- Keep catalog and blog links available on mobile. Featured links derive from
  the existing catalogs rather than a separate maintained list.
- Markdown rendering belongs in article components, separate from metadata
  parsing, so the homepage does not download the Markdown renderer.
- `src/styles/site.css` excludes dashboard-only sources from Tailwind scanning.
  Verify shared components still render correctly when changing those sources.
