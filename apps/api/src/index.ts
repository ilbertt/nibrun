import { runMigrations } from '#db/migrate.ts';
import { env } from '#lib/env.ts';
import { createLogger } from '#lib/logger.ts';

await runMigrations();

// Imported dynamically so the migrations run before the app opens its pool.
const { createApp } = await import('#app.ts');

const { server } = createApp().listen({ port: env.PORT, hostname: '0.0.0.0' });

createLogger('api').info(`listening on ${server!.url.origin}`);
