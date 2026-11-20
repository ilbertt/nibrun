import { expect, test } from 'bun:test';
import { accessFrom } from '#lib/jwt-access.ts';

const jwt = {
  'jwt-issuer': 'https://issuer.example',
  'jwt-audience': ['api', 'tools'],
  'jwks-url': 'https://issuer.example/keys',
};
test('JWT flags produce the generic access policy', () => {
  expect(accessFrom(jwt)).toEqual({
    kind: 'jwt',
    issuer: jwt['jwt-issuer'],
    audiences: ['api', 'tools'],
    publicKeys: { url: jwt['jwks-url'] },
    token: { header: 'Authorization', format: 'bearer' },
  });
  expect(accessFrom({ ...jwt, 'jwt-header': 'X-Assertion', 'jwt-format': 'raw' })).toMatchObject({
    token: { header: 'X-Assertion', format: 'raw' },
  });
});

test('omission, public access, and incomplete JWT settings are distinct', () => {
  expect(accessFrom({})).toBeUndefined();
  expect(accessFrom({ access: 'public' })).toEqual({ kind: 'public' });
  expect(() => accessFrom({ access: 'jwt' })).toThrow('--jwt-issuer');
  expect(() => accessFrom({ ...jwt, access: 'public' })).toThrow('--access public');
});
