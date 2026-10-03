import { DASHBOARD_SITE, PRODUCT_NAME } from '@repo/global-constants';
import tailwindcss from '@tailwindcss/vite';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Must match the api's PORT (see apps/api/.env.example).
const API_DEV_ORIGIN = 'http://localhost:3000';

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  // Vite substitutes `%NAME%` in index.html from these, which is the only way the static head
  // reaches a constant.
  define: {
    'import.meta.env.PRODUCT_NAME': JSON.stringify(PRODUCT_NAME),
    'import.meta.env.SITE_TITLE': JSON.stringify(DASHBOARD_SITE.title),
    'import.meta.env.SITE_DESCRIPTION': JSON.stringify(DASHBOARD_SITE.description),
    'import.meta.env.OG_IMAGE_URL': JSON.stringify(DASHBOARD_SITE.ogImage.url),
    'import.meta.env.OG_IMAGE_TYPE': JSON.stringify(DASHBOARD_SITE.ogImage.type),
    'import.meta.env.OG_IMAGE_WIDTH': JSON.stringify(DASHBOARD_SITE.ogImage.width),
    'import.meta.env.OG_IMAGE_HEIGHT': JSON.stringify(DASHBOARD_SITE.ogImage.height),
  },
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
  ],
});

export default config;
