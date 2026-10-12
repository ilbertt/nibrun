import { expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { ORIGIN, send } from '#tests/controllers/support/api.ts';

const { auth } = await import('#services/plugins.ts');

test('RFC 8414 discovery advertises the API origin and separate authentication endpoints', async () => {
  const response = await send({ url: `${ORIGIN}/.well-known/oauth-authorization-server` });
  expect(response.status).toBe(StatusMap.OK);
  const issuer = auth.options.baseURL;
  expect(await response.json()).toMatchObject({
    issuer,
    token_endpoint: `${issuer}/api/auth/oauth2/token`,
    jwks_uri: `${issuer}/api/auth/jwks`,
    scopes_supported: [],
    grant_types_supported: [],
  });
});

test('the provider cannot issue client credentials or user authorization grants', async () => {
  for (const grantType of ['client_credentials', 'authorization_code', 'refresh_token']) {
    const response = await send({
      method: 'POST',
      url: `${ORIGIN}/api/auth/oauth2/token`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: grantType, client_id: 'unknown' }).toString(),
    });
    expect(response.status).toBe(StatusMap['Bad Request']);
    expect(await response.json()).toMatchObject({ error: 'unsupported_grant_type' });
  }
});
