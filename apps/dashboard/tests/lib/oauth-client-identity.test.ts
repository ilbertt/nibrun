import { expect, test } from 'bun:test';
import { oauthClientIdentity } from '#lib/oauth-client-identity.ts';

test('CIMD identity shows the metadata origin without its path or query', () => {
  const identity = oauthClientIdentity({
    client_id: 'https://client.example/oauth/client.json?version=1',
    client_name: 'Example Client',
    client_uri: 'https://different.example/',
    logo_uri: 'https://client.example/logo.png',
    redirect_uris: ['https://client.example/callback'],
  });
  expect(identity.domain).toBe('client.example');
  expect(identity.name).toBe('Example Client');
  expect(identity.logoUrl).toBe('https://client.example/logo.png');
});

test('registered clients with opaque identifiers use the website domain and favicon', () => {
  const identity = oauthClientIdentity({
    client_id: 'registered-client',
    client_uri: 'https://client.example/about',
    redirect_uris: [],
  });
  expect(identity.domain).toBe('client.example');
  expect(identity.logoUrl).toBe('https://client.example/favicon.ico');
});

test('the favicon comes from the client website rather than the CIMD document', () => {
  const identity = oauthClientIdentity({
    client_id: 'https://identity.example/oauth/client.json',
    client_uri: 'https://client.example/about?campaign=oauth#connect',
    redirect_uris: [],
  });
  expect(identity.logoUrl).toBe('https://client.example/favicon.ico');
});

test('an unsafe client website does not produce a favicon request', () => {
  const identity = oauthClientIdentity({
    client_id: 'https://identity.example/oauth/client.json',
    client_uri: 'https://user:password@client.example/',
    redirect_uris: [],
  });
  expect(identity.logoUrl).toBeUndefined();
});

test('missing metadata falls back without displaying the opaque client identifier', () => {
  expect(
    oauthClientIdentity({ client_id: 'registered-client', client_name: '  ', redirect_uris: [] }),
  ).toEqual({ name: 'An app', domain: undefined, logoUrl: undefined });
});

test.each([
  'javascript:alert(1)',
  'data:image/svg+xml,logo',
  'https://user:password@client.example/logo.png',
  'invalid',
])('unsupported logo URLs fall back to the app icon: %s', (logoUri) => {
  expect(
    oauthClientIdentity({ client_id: 'registered-client', logo_uri: logoUri, redirect_uris: [] })
      .logoUrl,
  ).toBeUndefined();
});
