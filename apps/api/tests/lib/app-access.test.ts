import { expect, test } from 'bun:test';
import type { AppAccessPolicy } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { AppPatchSchema } from '#lib/api/app.ts';
import { accessColumns, appAccess } from '#lib/app-access.ts';
import { BadRequestError } from '#lib/errors.ts';
import { requiresCustomDomain, validatedAppAccess } from '#lib/validate-app-access.ts';
import { CreateAppRequestSchema } from '#routes/api/apps/model.ts';

const jwt = {
  kind: 'jwt',
  issuer: 'identity.example',
  audiences: ['reports'],
  token: { header: 'Authorization', format: 'bearer' },
  publicKeys: { url: 'https://id.example/keys' },
} satisfies AppAccessPolicy;

test('creation and patch accept the same JWT policy and reject missing identity constraints', () => {
  for (const access of [jwt, { kind: 'public' }]) {
    expect(Value.Check(CreateAppRequestSchema, { name: 'reports', config: { access } })).toBe(true);
    expect(Value.Check(AppPatchSchema, { config: { access } })).toBe(true);
  }
  expect(Value.Check(AppPatchSchema, { config: { access: { ...jwt, audiences: [] } } })).toBe(
    false,
  );
  expect(Value.Check(AppPatchSchema, { config: { access: { ...jwt, issuer: '' } } })).toBe(false);
  expect(Value.Check(AppPatchSchema, { config: { access: { ...jwt, algorithm: 'EdDSA' } } })).toBe(
    false,
  );
});

test('creation requires access in config and a patch accepts any supplied setting', () => {
  for (const body of [{}, { config: { access: jwt } }]) {
    expect(Value.Check(CreateAppRequestSchema, { name: 'reports', ...body })).toBe(true);
    expect(Value.Check(AppPatchSchema, { name: 'reports', ...body })).toBe(true);
  }
  for (const body of [{ access: jwt }, { config: {} }, { config: { unknown: true } }]) {
    expect(Value.Check(CreateAppRequestSchema, { name: 'reports', ...body })).toBe(false);
    expect(Value.Check(AppPatchSchema, body)).toBe(false);
  }
  for (const config of [
    { args: ['serve'] },
    { environment: { TOKEN: null } },
    { httpPort: 8080 },
  ]) {
    expect(Value.Check(AppPatchSchema, { config })).toBe(true);
    expect(Value.Check(CreateAppRequestSchema, { name: 'reports', config })).toBe(false);
  }
});

test('creating and editing JWT access require a key set URL', () => {
  const { publicKeys: _publicKeys, ...withoutKeys } = jwt;
  for (const access of [
    withoutKeys,
    { ...jwt, publicKeys: {} },
    { ...jwt, publicKeys: ['inline key'] },
  ]) {
    expect(Value.Check(CreateAppRequestSchema, { name: 'reports', config: { access } })).toBe(
      false,
    );
    expect(Value.Check(AppPatchSchema, { config: { access } })).toBe(false);
  }
  expect(appAccess(accessColumns(validatedAppAccess(jwt)))).toEqual(jwt);
});

test('a private key set endpoint is refused', () => {
  expect(() =>
    validatedAppAccess({ ...jwt, publicKeys: { url: 'https://127.0.0.1/keys' } }),
  ).toThrow(BadRequestError);
});

test('the domain requirement follows the assertion header regardless of issuer, audiences or token format', () => {
  expect(
    requiresCustomDomain({
      ...jwt,
      audiences: ['a', 'b'],
      token: { header: 'cF-access-JWT-assertion', format: 'bearer' },
    }),
  ).toBe(true);
  expect(requiresCustomDomain(jwt)).toBe(false);
});
