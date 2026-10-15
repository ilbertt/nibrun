import { t } from 'elysia';
import { MAX_REMOTE_URL_LENGTH, REMOTE_URL_PATTERN } from '#lib/remote-url.ts';

export const GetOAuthClientIconQuerySchema = t.Object({
  url: t.String({ pattern: REMOTE_URL_PATTERN, maxLength: MAX_REMOTE_URL_LENGTH, format: 'uri' }),
});

export const GetOAuthClientIconResponseSchema = t.Object({
  iconUrl: t.Nullable(t.String({ format: 'uri' })),
});
