import { describe, expect, test } from 'bun:test';
import { type Hostname, HostnameSchema, isValidMessage, Value } from '@repo/protocol';
import { dcvMethodFor, isPlatformHostname, platformHostname } from '#lib/app-hostname.ts';
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

describe('a hostname the platform hands out is not one an owner may bring', () => {
  function brought(hostname: string): boolean {
    return !isPlatformHostname({
      hostname: hostname as Hostname,
      appHostDomain: APP_HOST_DOMAIN,
    });
  }

  // The unique index stops a brought domain taking a name another app already holds. It cannot
  // stop one taking a name no app holds yet — and the platform would hand that name out later.
  test('a slug nothing has been minted under yet is still refused', () => {
    expect(brought('not-created-yet.apps.example.com')).toBe(false);
  });

  test('and so is the app domain itself', () => {
    expect(brought(APP_HOST_DOMAIN)).toBe(false);
  });

  // `notapps.example.com` ends with the domain as a *string* and is a different registrable
  // domain entirely, so refusing it would refuse a domain somebody legitimately owns.
  test("a domain that merely ends in the same letters is somebody else's to bring", () => {
    expect(brought(`not${APP_HOST_DOMAIN}`)).toBe(true);
  });

  test('an ordinary brought domain is allowed', () => {
    expect(brought('app.example.dev')).toBe(true);
  });
});

describe('a hostname is proved the way its place in DNS allows', () => {
  function hostname(value: string): Hostname {
    return Value.Parse(HostnameSchema, value);
  }

  test('a subdomain by delegation, which issues the certificate before traffic moves', () => {
    expect(dcvMethodFor(hostname('app.example.dev'))).toBe('txt');
    expect(dcvMethodFor(hostname('www.example.co.uk'))).toBe('txt');
  });

  // A zone on Cloudflare answers TXT at `_acme-challenge.<apex>` from its own certificate's
  // records rather than the owner's CNAME, so delegation there waits on Cloudflare, not the owner.
  test('an apex over HTTP, which asks nothing of the name the zone itself uses', () => {
    expect(dcvMethodFor(hostname('example.dev'))).toBe('http');
    expect(dcvMethodFor(hostname('example.co.uk'))).toBe('http');
  });
});
