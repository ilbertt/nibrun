import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WWW_SITE } from '@repo/global-constants';

const CLIENT_DIST_DIR = join(import.meta.dirname, '..', 'dist', 'client');
const urls = new Set<string>();

// Canonicals come from the rendered pages, so crawled fragments and query strings cannot
// introduce duplicate entries, and worker-only redirects and Markdown stay out of the sitemap.
for await (const file of new Bun.Glob('**/*.html').scan(CLIENT_DIST_DIR)) {
  const html = await readFile(join(CLIENT_DIST_DIR, file), 'utf8');
  const canonical = /<link\b[^>]*\brel="canonical"[^>]*>/.exec(html)?.[0];
  const url = canonical === undefined ? undefined : /\bhref="([^"]+)"/.exec(canonical)?.[1];

  if (url === undefined) {
    throw new Error(`Missing canonical URL in ${file}`);
  }

  urls.add(url);
}

if (urls.size === 0) {
  throw new Error('No prerendered pages found for the sitemap');
}

// The href is already escaped as an HTML attribute, which also escapes XML text content.
const entries = [...urls].sort().map((url) => `  <url><loc>${url}</loc></url>`);
await writeFile(
  join(CLIENT_DIST_DIR, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`,
);
await writeFile(
  join(CLIENT_DIST_DIR, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${WWW_SITE.url}/sitemap.xml\n`,
);

console.log(`Generated sitemap with ${urls.size} URLs`);
