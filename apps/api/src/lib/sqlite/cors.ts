import { cors } from '@elysia/cors';
import { SQLITE_CONNECTIONS_BASE_PATH } from '#lib/sqlite/routes.ts';

export const SqliteClientCorsPlugin = cors({
  aot: true,
  origin(request) {
    return new URL(request.url).pathname.startsWith(SQLITE_CONNECTIONS_BASE_PATH);
  },
  credentials: false,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  exposeHeaders: [],
  maxAge: 5,
  preflight: true,
});
