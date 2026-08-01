import { Elysia } from 'elysia';
import { sql } from '#db/client.ts';
import { auth } from '#lib/auth.ts';
import { UnauthorizedError } from '#lib/errors.ts';
import { createLogger } from '#lib/logger.ts';
import { AssetsRepository } from '#repositories/assets.repository.ts';
import { HealthRepository } from '#repositories/health.repository.ts';
import { AssetsService } from '#services/assets.service.ts';
import { HealthService } from '#services/health.service.ts';

const assetsRepository = new AssetsRepository(sql);
const healthRepository = new HealthRepository(sql);

const assetsService = new AssetsService(assetsRepository);
const healthService = new HealthService(healthRepository);

export function loggerPlugin(name: string) {
  const logger = createLogger(name);
  return new Elysia({ name: `logger.${name}` }).derive({ as: 'scoped' }, () => ({ logger }));
}

/** Gates a route behind a session with `{ auth: true }`, handing it `user` and `session`. */
export const AuthPlugin = new Elysia({ name: 'auth' }).macro({
  auth: {
    async resolve({ request }) {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session) {
        throw new UnauthorizedError();
      }
      return { user: session.user, session: session.session };
    },
  },
});

export const AssetsServicePlugin = new Elysia({ name: 'service.assets' }).decorate(
  'assetsService',
  assetsService,
);

export const HealthServicePlugin = new Elysia({ name: 'service.health' }).decorate(
  'healthService',
  healthService,
);
