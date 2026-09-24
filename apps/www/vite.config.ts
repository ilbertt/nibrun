import { cloudflare } from '@cloudflare/vite-plugin';
import { WWW_DEPLOY_PATH } from '@repo/global-constants';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The landing page is prerendered to static HTML, so a visit is served from the edge and
// never wakes the worker — `cloudflare` is here to run the same Workers runtime in dev and
// build as in production, not because a page view needs compute.
const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        filter: (page) => !answeredByWorker(page.path),
      },
    }),
    viteReact(),
  ],
});

/**
 * Whether `src/server.ts` answers this address itself, in which case the crawler has to leave it
 * alone: it follows every root-relative `<a href>` it renders, and a page it writes is a static
 * asset the edge hands back without ever waking the worker.
 *
 * A post's "View markdown" link would be typed by its extension rather than by us. A deploy link
 * has no route behind it at all — the worker redirects it to the dashboard's deploy screen — so a
 * page written for one is an empty shell, and the roller on the landing page renders exactly one
 * of them for the crawler to find.
 */
function answeredByWorker(path: string): boolean {
  return path.endsWith('.md') || path === WWW_DEPLOY_PATH || path.startsWith(`${WWW_DEPLOY_PATH}/`);
}

export default config;
