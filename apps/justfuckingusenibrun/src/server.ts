import page from './index.html';

const DEFAULT_PORT = 3000;

const server = Bun.serve({
  hostname: '0.0.0.0',
  port: Number(process.env.PORT ?? DEFAULT_PORT),
  routes: { '/': page },
});

console.log(`Serving on ${server.url}`);
