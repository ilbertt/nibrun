import { cors } from '@elysia/cors';
import { RoutePrefix } from '#lib/routes/prefixes.ts';
import { SQLITE_CONNECTIONS_BASE_PATH } from '#lib/sqlite/routes.ts';

export const clientCorsPlugin = cors({
  aot: true,
  origin(request) {
    const { pathname } = new URL(request.url);
    return (
      pathname.startsWith(SQLITE_CONNECTIONS_BASE_PATH) ||
      pathname.startsWith(`${RoutePrefix.WellKnown}/`)
    );
  },
  credentials: false,
  methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  exposeHeaders: [],
  maxAge: 5,
  preflight: true,
});
