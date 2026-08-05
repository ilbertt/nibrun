import { describe, expect, test } from 'bun:test';
import { HostnameSchema, isValidMessage } from '@repo/protocol';
import { platformHostname } from '#lib/app-hostname.ts';
import { deriveAppSlug } from '#lib/app-slug.ts';

const APP_HOST_DOMAIN = 'apps.example.com';
const SAMPLE_SIZE = 50;

describe('an app is reachable at its slug under the app domain', () => {
  test('the label is joined to the domain', () => {
    expect(
      platformHostname({ slug: deriveAppSlug('pocketbase'), appHostDomain: APP_HOST_DOMAIN }),
    ).toMatch(/^pocketbase-[0-9a-z]{6}\.apps\.example\.com$/);
  });

  // A derived label that produced an unroutable hostname would only fail once the app was
  // already created and someone tried to reach it.
  test('every derived label yields a hostname the protocol accepts', () => {
    const names = ['pocketbase', 'My Great App!', '🎉🎉🎉', '日本語', '...', 'xn--n3h'];

    for (const name of names) {
      for (let sample = 0; sample < SAMPLE_SIZE; sample++) {
        const hostname = platformHostname({
          slug: deriveAppSlug(name),
          appHostDomain: APP_HOST_DOMAIN,
        });
        expect(isValidMessage({ schema: HostnameSchema, value: hostname })).toBe(true);
      }
    }
  });
});
