import favicon from './favicon.svg' with { type: 'file' };
import page from './index.html' with { type: 'file' };

const DEFAULT_PORT = 3000;

const server = Bun.serve({
  hostname: '0.0.0.0',
  port: Number(process.env.PORT ?? DEFAULT_PORT),
  routes: {
    '/': new Response(Bun.file(page)),
    '/favicon.svg': new Response(Bun.file(favicon)),
  },
});

console.log(`Serving on ${server.url}`);
