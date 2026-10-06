import type { Static, TSchema, TUnsafe } from '@sinclair/typebox';
import type { Brand } from '#brand.ts';

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

// Rebuilding with Type.Unsafe would change the runtime Kind and lose the original validator.
export function publicSchema<Schema extends TSchema>(
  schema: Schema,
): TUnsafe<PublicValue<Static<Schema>>> {
  return schema as unknown as TUnsafe<PublicValue<Static<Schema>>>;
}
