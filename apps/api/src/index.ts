import { runMigrations } from '#db/migrate.ts';
import { env } from '#lib/env.ts';
import { createLogger } from '#lib/logger.ts';

await runMigrations();

// Imported dynamically so the migrations run before the app opens its pool.
const { createApp } = await import('#app.ts');

// Bun closes a request that has gone quiet for ten seconds, which is the resting state of a
// tenant log stream: an app that is not printing sends nothing, and the agent holds the request
// open anyway. This is Bun's ceiling, and the agent keeps the connection under it with a
// keepalive rather than relying on the tenant to keep talking.
const IDLE_TIMEOUT_SECONDS = 255;

const { server } = createApp().listen({
  port: env.PORT,
  hostname: '0.0.0.0',
  idleTimeout: IDLE_TIMEOUT_SECONDS,
});

createLogger('api').info(`listening on ${server!.url.origin}`);
