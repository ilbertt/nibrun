import { expect, test } from 'bun:test';
import { Kind } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  AppNameSchema,
  FilenameSchema,
  GuestPathSchema,
  HttpPortSchema,
  TenantEnvironmentPatchSchema,
} from '#validation.ts';

const VALID_HTTP_PORT = 8080;
const NONINTEGER_PORT = 8080.5;

// Type.Unsafe carries Treaty-derived types; the original kinds must still enforce validation.
test('generated validators retain their runtime kinds', () => {
  expect(AppNameSchema[Kind]).toBe('String');
  expect(HttpPortSchema[Kind]).toBe('Integer');
  expect(Value.Check(AppNameSchema, '')).toBe(false);
  expect(Value.Check(HttpPortSchema, 0)).toBe(false);
  expect(Value.Check(HttpPortSchema, NONINTEGER_PORT)).toBe(false);
  expect(Value.Check(FilenameSchema, '../binary')).toBe(false);
  expect(Value.Check(GuestPathSchema, '/data/../secret')).toBe(false);
  expect(Value.Check(HttpPortSchema, VALID_HTTP_PORT)).toBe(true);
  expect(Value.Check(FilenameSchema, 'server')).toBe(true);
  expect(Value.Check(GuestPathSchema, '/data/settings')).toBe(true);
});

test('environment patches remove values while rejecting names and references the API refuses', () => {
  expect(Value.Check(TenantEnvironmentPatchSchema, { TOKEN: null })).toBe(true);
  expect(Value.Check(TenantEnvironmentPatchSchema, { 'NOT-A-NAME': 'value' })).toBe(false);
  expect(Value.Check(TenantEnvironmentPatchSchema, JSON.parse('{"__proto__":"value"}'))).toBe(
    false,
  );
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the runtime reference is literal input
  expect(Value.Check(TenantEnvironmentPatchSchema, { URL: '${NIBRUN_HOSTNAME}' })).toBe(true);
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the misspelled runtime reference is literal input
  expect(Value.Check(TenantEnvironmentPatchSchema, { URL: '${NIBRUN_HSOTNAME}' })).toBe(false);
});
