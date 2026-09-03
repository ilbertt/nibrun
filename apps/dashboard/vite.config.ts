import { DASHBOARD_SITE, PRODUCT_NAME } from '@repo/global-constants';
import tailwindcss from '@tailwindcss/vite';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Must match the api's PORT (see apps/api/.env.example).
const API_DEV_ORIGIN = 'http://localhost:3000';

const HEAD_TOKENS = {
  '%PRODUCT_NAME%': PRODUCT_NAME,
  '%SITE_TITLE%': DASHBOARD_SITE.title,
  '%SITE_DESCRIPTION%': DASHBOARD_SITE.description,
  '%OG_IMAGE_URL%': DASHBOARD_SITE.ogImage.url,
  '%OG_IMAGE_TYPE%': DASHBOARD_SITE.ogImage.type,
  '%OG_IMAGE_WIDTH%': `${DASHBOARD_SITE.ogImage.width}`,
  '%OG_IMAGE_HEIGHT%': `${DASHBOARD_SITE.ogImage.height}`,
};

function siteHead(): Plugin {
  return {
    name: 'site-head',
    transformIndexHtml(html) {
      let out = html;
      for (const [token, value] of Object.entries(HEAD_TOKENS)) {
        out = out.replaceAll(token, value);
      }
      return out;
    },
  };
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    proxy: {
      '/api': API_DEV_ORIGIN,
    },
  },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    viteReact(),
    siteHead(),
  ],
});

export default config;
