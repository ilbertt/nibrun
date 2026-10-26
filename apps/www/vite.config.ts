import { cloudflare } from '@cloudflare/vite-plugin';
import { LLMS_TXT_PATH, WWW_DEPLOY_PATH } from '@repo/global-constants';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { redact } from '@tanstack/redact/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The landing page is prerendered to static HTML, so a visit is served from the edge and
// never wakes the worker — `cloudflare` is here to run the same Workers runtime in dev and
// build as in production, not because a page view needs compute.
const config = defineConfig({
  resolve: { tsconfigPaths: true },
  ssr: { noExternal: true },
  plugins: [
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        filter: (page) => {
          const exclude =
            answeredByWorker(page.path) ||
            page.path === LLMS_TXT_PATH ||
            /[?#]/.test(page.path) ||
            (page.path !== '/' && page.path.endsWith('/'));

          return !exclude;
        },
      },
      sitemap: {
        enabled: false,
      },
    }),
    viteReact(),
    redact(),
  ],
});

// Prerendered assets bypass the worker, which owns deploy redirects and Markdown content types.
function answeredByWorker(path: string): boolean {
  return path.endsWith('.md') || path === WWW_DEPLOY_PATH || path.startsWith(`${WWW_DEPLOY_PATH}/`);
}

export default config;
