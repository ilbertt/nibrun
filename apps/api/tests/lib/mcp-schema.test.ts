import { expect, test } from 'bun:test';
import { HranaStmtSchema } from '@repo/sqlite';
import { Type } from '@sinclair/typebox';
import { fromTypeBox } from '#lib/mcp/schema.ts';

test('MCP schemas accept repeated inline TypeBox IDs in positional and named SQLite values', async () => {
  const schema = fromTypeBox(HranaStmtSchema);
  expect(
    await schema['~standard'].validate({
      sql: 'SELECT ? + :offset',
      args: [{ type: 'integer', value: '1' }],
      named_args: [{ name: 'offset', value: { type: 'integer', value: '2' } }],
    }),
  ).toHaveProperty('value');
  expect(
    await schema['~standard'].validate({ args: [{ type: 'integer', value: 'invalid' }] }),
  ).toHaveProperty('issues');
});

test('MCP schemas preserve IDs referenced by recursive TypeBox schemas', async () => {
  const schema = fromTypeBox(
    Type.Recursive(
      function node(self) {
        return Type.Object({ value: Type.String(), children: Type.Array(self) });
      },
      { $id: 'Node' },
    ),
  );
  expect(
    await schema['~standard'].validate({
      value: 'root',
      children: [{ value: 'child', children: [] }],
    }),
  ).toHaveProperty('value');
  expect(
    await schema['~standard'].validate({
      value: 'root',
      children: [{ value: 1, children: [] }],
    }),
  ).toHaveProperty('issues');
});
