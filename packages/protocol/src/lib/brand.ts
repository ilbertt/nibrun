import type { TSchema } from '@sinclair/typebox';

declare const brand: unique symbol;

export type Brand<Value, Name extends string> = Value & { readonly [brand]: Name };

// TypeBox reads a schema's TypeScript type off its `static` property, so intersecting that
// property is enough to brand the derived type. The runtime object is left byte-for-byte as
// TypeBox built it, which is what keeps validation behaving exactly as it does unbranded —
// `Type.Unsafe` would rewrite the schema's Kind instead, and a schema TypeBox no longer
// recognises is a schema it accepts everything against.
export type BrandedSchema<Schema extends TSchema, Value> = Schema & { static: Value };
