import { expect, test } from 'bun:test';
import { accessFields, parseAccess } from '#lib/app-access-form.ts';

const initial = accessFields({ kind: 'public' });

test('Cloudflare team name and AUD become an ordinary JWT policy and reopen in the preset', () => {
  const policy = parseAccess({
    ...initial,
    mode: 'cloudflare',
    team: 'acme',
    cloudflareAudience: 'reports',
  }).policy;
  expect(policy).toEqual({
    kind: 'jwt',
    issuer: 'https://acme.cloudflareaccess.com',
    audiences: ['reports'],
    publicKeys: { url: 'https://acme.cloudflareaccess.com/cdn-cgi/access/certs' },
    token: { header: 'Cf-Access-Jwt-Assertion', format: 'raw' },
  });
  if (policy?.kind !== 'jwt') {
    throw new Error('expected JWT');
  }
  expect(accessFields(policy).mode).toBe('cloudflare');
  expect(parseAccess(accessFields(policy)).policy).toEqual(policy);
  expect(accessFields({ ...policy, audiences: ['reports', 'tools'] }).mode).toBe('jwt');
});

test('custom settings round-trip and invalid input cannot become public access', () => {
  const custom = {
    ...initial,
    mode: 'jwt',
    issuer: 'issuer',
    audiences: 'api\ntools',
    jwksUrl: 'https://identity.example/keyset',
    header: 'X-Token',
    format: 'raw',
  } as const;
  const policy = parseAccess(custom).policy;
  if (!policy) {
    throw new Error('expected custom policy');
  }
  expect(parseAccess(accessFields(policy)).policy).toEqual(policy);
  expect(parseAccess({ ...custom, jwksUrl: 'http://example.com/keys' }).policy).toBeUndefined();
  expect(
    parseAccess({
      ...initial,
      mode: 'cloudflare',
      team: 'unrelated.example',
      cloudflareAudience: 'test',
    }).policy,
  ).toBeUndefined();
  expect(parseAccess({ ...custom, mode: 'public' }).policy).toEqual({ kind: 'public' });
});
