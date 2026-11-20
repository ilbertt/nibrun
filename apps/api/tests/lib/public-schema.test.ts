import { expect, test } from 'bun:test';
import { publicSchema } from '@repo/typebox-extensions';
import { Kind } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { Elysia, StatusMap } from 'elysia';
import { AppPatchSchema } from '#lib/api/app.ts';
import { CreateAppRequestSchema } from '#routes/api/apps/model.ts';

const patchSchema = publicSchema(AppPatchSchema);
const createSchema = publicSchema(CreateAppRequestSchema);
const app = new Elysia({ normalize: false }).patch('/app', ({ body }) => body, {
  body: patchSchema,
});

const access = { kind: 'public' } as const;
const INVALID_PATCHES = [
  { config: { access, environment: { TOKEN: 42 } } },
  { config: { access, environment: { 'NOT-A-NAME': 'value' } } },
  { config: { access, environment: JSON.parse('{"__proto__":"value"}') } },
  { config: { access, environment: { TOKEN: `\${NIBRUN_UNKNOWN}` } } },
  { config: { access, httpPort: 0 } },
  { name: '' },
];

test('public typing preserves the original schema and runtime kind', () => {
  expect(patchSchema).toBe(AppPatchSchema);
  expect(patchSchema[Kind]).toBe(AppPatchSchema[Kind]);
  expect(
    Value.Check(patchSchema, { config: { access, environment: { TOKEN: 'value', REMOVE: null } } }),
  ).toBe(true);
  expect(
    Value.Check(createSchema, { name: 'server', config: { access, environment: { TOKEN: null } } }),
  ).toBe(false);
});

test.each(INVALID_PATCHES)('public routes still reject invalid input %j', async (body) => {
  expect(Value.Check(patchSchema, body)).toBe(false);
  const response = await app.handle(
    new Request('http://localhost/app', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  expect(response.status).toBe(StatusMap['Unprocessable Content']);
});

test('an HTTP patch preserves arbitrary variable names and deletion markers', async () => {
  const body = { config: { access, environment: { TOKEN: 'value', REMOVE: null } } };
  const response = await app.handle(
    new Request('http://localhost/app', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  expect(response.status).toBe(StatusMap.OK);
  expect(await response.json()).toEqual(body);
});
