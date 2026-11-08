import { expect, test } from 'bun:test';
import { compile } from 'json-schema-to-typescript';
import { nibrunnerTenantLogSchema } from '#shared/nibrunner-schema.ts';

test('referenced restart fields survive beside the log kind discriminator', async () => {
  const schema = {
    title: 'Event',
    oneOf: [
      {
        type: 'object',
        $ref: '#/$defs/Restart',
        properties: { kind: { const: 'restart', type: 'string' } },
        required: ['kind'],
      },
    ],
    $defs: {
      Restart: {
        type: 'object',
        properties: { reason: { type: 'string' } },
        required: ['reason'],
      },
    },
  };
  const original = structuredClone(schema);
  const declarations = await compile(nibrunnerTenantLogSchema(schema), schema.title);
  expect(declarations).toContain('reason: string;');
  expect(declarations).toMatch(/kind: ["']restart["'];/);
  expect(schema).toEqual(original);
});
