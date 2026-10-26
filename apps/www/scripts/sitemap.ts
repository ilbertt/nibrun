import { join } from 'node:path';
import { WWW_SITE } from '@repo/global-constants';

const clientDirectory = join(import.meta.dirname, '..', 'dist', 'client');
const urls = new Set<string>();

for await (const path of new Bun.Glob('**/index.html').scan(clientDirectory)) {
  const html = await Bun.file(join(clientDirectory, path)).text();
  const canonicals: string[] = [];
  await new HTMLRewriter()
    .on('head link[rel="canonical"]', {
      element(element) {
        const href = element.getAttribute('href');
        if (href !== null) {
          canonicals.push(href);
        }
      },
    })
    .transform(new Response(html))
    .text();

  const expectedPath = path === 'index.html' ? '/' : `/${path.slice(0, -'/index.html'.length)}`;
  const expectedUrl = `${WWW_SITE.url}${expectedPath}`;
  if (canonicals.length !== 1 || canonicals[0] !== expectedUrl) {
    throw new Error(`${path} must declare exactly one canonical: ${expectedUrl}`);
  }
  urls.add(expectedUrl);
}

if (!urls.has(`${WWW_SITE.url}/`)) {
  throw new Error('The homepage must be prerendered before generating the sitemap');
}

// Build dates would falsely signal changes on every deployment; lastmod is optional.
const entries = [...urls]
  .sort()
  .map((url) => `  <url><loc>${Bun.escapeHTML(url)}</loc></url>`)
  .join('\n');
await Bun.write(
  join(clientDirectory, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`,
);
console.info(`Generated sitemap for ${urls.size} canonical pages`);
