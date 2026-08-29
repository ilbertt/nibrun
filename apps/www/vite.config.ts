import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { DEPLOY_PATHS } from './deploy-presets.ts';

// The landing page is prerendered to static HTML, so a visit is served from the edge and
// never wakes the worker — `cloudflare` is here to run the same Workers runtime in dev and
// build as in production, not because a page view needs compute.
const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart({
      // The routes with a slug in them, which the crawler cannot reach: nothing links to a
      // preset, and a link that did would be the landing page recommending one. The static
      // routes are still discovered, so this list is only the ones that are ours to name.
      pages: DEPLOY_PATHS.map((path) => ({ path })),
      prerender: {
        enabled: true,
        // The crawler follows every root-relative `<a href>` it renders, which includes each
        // post's "View markdown" link. Prerendered, those would become static assets typed by
        // extension rather than by us — so they are left to the worker, which serves them as
        // `text/markdown`.
        filter: (page) => !page.path.endsWith('.md'),
      },
    }),
    viteReact(),
  ],
});

export default config;
