import type { Brand, BrandedSchema } from '@repo/typebox-extensions';
import { type StringOptions, type TString, Type } from '@sinclair/typebox';

export const SECRET_ANNOTATION = 'x-nibrun-secret';
const MAX_SECRET_LENGTH = 32_768;
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
