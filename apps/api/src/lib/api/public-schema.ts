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

// Treaty preserves private brands from schema static types. Expose JSON primitives while
// retaining the original runtime schema and its validation constraints.
export function publicSchema<Schema extends TSchema>(
  schema: Schema,
): TUnsafe<PublicValue<Static<Schema>>> {
  return schema as unknown as TUnsafe<PublicValue<Static<Schema>>>;
}
