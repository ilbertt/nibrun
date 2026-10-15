import { expect, test } from 'bun:test';
import { OAuthClientIconService } from '#services/oauth-client-icon.service.ts';

test('resolves a declared relative icon against the page reached after redirects', async () => {
  const service = new OAuthClientIconService({
    clientWebsiteRepo: {
      read() {
        return Promise.resolve({
          url: new URL('https://client.example/sign-in/'),
          html: '<head><link rel="icon" href="brand.svg"></head>',
        });
      },
    },
  });
  expect(await service.discover({ url: 'https://client.example/' })).toBe(
    'https://client.example/sign-in/brand.svg',
  );
});

test('an unavailable or rejected website leaves the generic consent icon usable', async () => {
  const service = new OAuthClientIconService({
    clientWebsiteRepo: {
      read() {
        return Promise.reject(new Error('The website is unreachable or not public'));
      },
    },
  });
  expect(await service.discover({ url: 'https://client.example/' })).toBeNull();
});
