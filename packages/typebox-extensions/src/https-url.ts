import { type StringOptions, Type } from '@sinclair/typebox';

export function httpsUrl(options: StringOptions = {}) {
  return Type.String({ ...options, pattern: '^https://[^\\s]+$' });
}
