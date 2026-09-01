import favicon from './favicon.svg' with { type: 'text' };
// bun-types resolves every `.html` to an HTMLBundle, whatever the import attribute says. The
// attribute is what decides the loader, so this is a path — and serving it keeps the page the
// bytes in the file, rather than the bundler's rewrite of them with a JS chunk attached.
import page from './index.html' with { type: 'file' };

const DEFAULT_PORT = 3000;

const server = Bun.serve({
  hostname: '0.0.0.0',
  port: Number(process.env.PORT ?? DEFAULT_PORT),
  routes: {
    '/': new Response(Bun.file(page as unknown as string)),
    '/favicon.svg': new Response(favicon, { headers: { 'content-type': 'image/svg+xml' } }),
  },
});

console.log(`Serving on ${server.url}`);
