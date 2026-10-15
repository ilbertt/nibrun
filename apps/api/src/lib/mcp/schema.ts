import { fromJsonSchema, type JsonSchemaType } from '@modelcontextprotocol/server';
import type { Static, TSchema } from '@sinclair/typebox';

export function fromTypeBox<Schema extends TSchema>(schema: Schema) {
  // Elysia adds OpenAPI's nullable annotation to anyOf; MCP validators expect JSON Schema.
  const jsonSchema: JsonSchemaType = JSON.parse(
    JSON.stringify(schema, function jsonSchemaAnnotation(...[key, value]) {
      return key === 'nullable' && typeof value === 'boolean' ? undefined : value;
    }),
  );
  return fromJsonSchema<Static<Schema>>(jsonSchema);
}
