import { expect, test } from 'bun:test';
import { t } from 'elysia';
import { fromTypeBox } from '#lib/mcp/schema.ts';

test('adapts Elysia nullable schemas without dropping a property named nullable', async () => {
  const source = t.Object({ nullable: t.Nullable(t.String()) });
  const schema = fromTypeBox(source);
  const jsonSchema = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
  expect(jsonSchema).toMatchObject({
    properties: { nullable: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
  });
  expect(jsonSchema).not.toHaveProperty('properties.nullable.nullable');
  expect(source.properties.nullable.nullable).toBe(true);
  expect(await schema['~standard'].validate({ nullable: null })).toEqual({
    value: { nullable: null },
  });
  expect(await schema['~standard'].validate({ nullable: 42 })).toHaveProperty('issues');
});
