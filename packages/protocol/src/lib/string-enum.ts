import { type TLiteral, type TUnion, Type } from '@sinclair/typebox';

type Literals<Values extends readonly string[]> = {
  -readonly [Index in keyof Values]: TLiteral<Values[Index] & string>;
};

/**
 * Builds a union-of-literals schema from a single list of values, so the schema, the
 * TypeScript type and anything that needs to iterate the states all derive from one array.
 */
export function stringEnum<const Values extends readonly string[]>(
  values: Values,
): TUnion<Literals<Values>> {
  return Type.Union(values.map((value) => Type.Literal(value))) as unknown as TUnion<
    Literals<Values>
  >;
}
