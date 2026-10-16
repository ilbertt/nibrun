import { fromJsonSchema, type JsonSchemaType } from '@modelcontextprotocol/server';
import type { Static, TSchema } from '@sinclair/typebox';

export function fromTypeBox<Schema extends TSchema>(schema: Schema) {
  const referencedIds = new Set<string>();
  collectSchemaReferences({ node: schema, referencedIds });
  // Elysia adds OpenAPI's nullable annotation to anyOf; MCP validators expect JSON Schema.
  const jsonSchema: JsonSchemaType = JSON.parse(
    JSON.stringify(schema, function jsonSchemaAnnotation(...[key, value]) {
      // AJV rejects repeated inline TypeBox IDs, even when their schemas are identical.
      if (key === '$id' && typeof value === 'string' && !referencedIds.has(value)) {
        return undefined;
      }
      return key === 'nullable' && typeof value === 'boolean' ? undefined : value;
    }),
  );
  return fromJsonSchema<Static<Schema>>(jsonSchema);
}

function collectSchemaReferences({
  node,
  referencedIds,
}: {
  node: unknown;
  referencedIds: Set<string>;
}): void {
  if (node === null || typeof node !== 'object') {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string') {
      referencedIds.add(value.split('#')[0]!);
    } else {
      collectSchemaReferences({ node: value, referencedIds });
    }
  }
}
