import { Kind, type StringOptions, type TSchema, type TString, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { Brand, BrandedSchema } from '#lib/brand.ts';

const SECRET_ANNOTATION = 'x-nibrun-secret';

const MAX_SECRET_LENGTH = 32_768;

export const REDACTED = '[redacted]';

export type SecretString = Brand<string, 'SecretString'>;

// Annotated rather than merely named, so redaction is driven by the schema: a field added
// later is redacted because it is declared secret, not because someone remembered to extend
// a list of field names somewhere else. A caller narrowing one further says only what differs,
// so what makes a string a secret is stated once whatever else is asked of it.
export function secretString(options: StringOptions = {}) {
  return Type.String({
    ...options,
    [SECRET_ANNOTATION]: true,
    maxLength: MAX_SECRET_LENGTH,
  }) as BrandedSchema<TString, SecretString>;
}

export const SecretStringSchema = secretString();

const isSecret = (schema: TSchema) => schema[SECRET_ANNOTATION] === true;

type SchemaWithProperties = TSchema & { properties: Record<string, TSchema> };
type SchemaWithItems = TSchema & { items: TSchema };
type SchemaWithPatternProperties = TSchema & { patternProperties: Record<string, TSchema> };
type SchemaWithVariants = TSchema & { anyOf: TSchema[] };

/**
 * Returns a copy of `value` with every leaf the schema declares secret replaced by
 * {@link REDACTED}. Anything the schema does not describe is passed through untouched, so
 * this is safe to apply to a whole message before logging it.
 */
export function redactSecrets({ schema, value }: { schema: TSchema; value: unknown }): unknown {
  if (isSecret(schema)) {
    return value === undefined ? value : REDACTED;
  }

  switch (schema[Kind]) {
    case 'Object':
      return redactObject({ schema: schema as SchemaWithProperties, value });
    case 'Array':
      return redactArray({ schema: schema as SchemaWithItems, value });
    case 'Record':
      return redactRecord({ schema: schema as SchemaWithPatternProperties, value });
    case 'Union':
      return redactUnion({ schema: schema as SchemaWithVariants, value });
    default:
      return value;
  }
}

function redactObject({ schema, value }: { schema: SchemaWithProperties; value: unknown }) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const property = schema.properties[key];
      return [key, property ? redactSecrets({ schema: property, value: entry }) : entry];
    }),
  );
}

function redactArray({ schema, value }: { schema: SchemaWithItems; value: unknown }) {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.map((entry) => redactSecrets({ schema: schema.items, value: entry }));
}

function redactRecord({ schema, value }: { schema: SchemaWithPatternProperties; value: unknown }) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const patterns = Object.entries(schema.patternProperties);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const matched = patterns.find(([pattern]) => new RegExp(pattern).test(key));
      return [key, matched ? redactSecrets({ schema: matched[1], value: entry }) : entry];
    }),
  );
}

function redactUnion({ schema, value }: { schema: SchemaWithVariants; value: unknown }) {
  const variant = schema.anyOf.find((candidate) => Value.Check(candidate, value));
  return variant ? redactSecrets({ schema: variant, value }) : value;
}
