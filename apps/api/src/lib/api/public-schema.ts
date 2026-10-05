import type { Brand } from '@repo/protocol';
import type { Static, TSchema, TUnsafe } from '@sinclair/typebox';

export type PublicValue<Value> =
  Value extends Brand<string, string>
    ? string
    : Value extends Brand<number, string>
      ? number
      : Value extends readonly unknown[]
        ? { [Key in keyof Value]: PublicValue<Value[Key]> }
        : Value extends object
          ? { [Key in keyof Value]: PublicValue<Value[Key]> }
          : Value;

// Elysia's module inference loses TypeBox record keys. Preserve the schema's runtime kind
// and constraints while exposing its JSON values, without internal brands, to HTTP callers.
export function publicSchema<Schema extends TSchema>(
  schema: Schema,
): TUnsafe<PublicValue<Static<Schema>>> {
  return schema as unknown as TUnsafe<PublicValue<Static<Schema>>>;
}
