import type { Brand, BrandedSchema } from '@repo/typebox-extensions';
import { type TString, Type } from '@sinclair/typebox';

const DNS_LABEL_PATTERN = '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$';
export const MAX_DNS_LABEL_LENGTH = 63;
export type DnsLabel = Brand<string, 'DnsLabel'>;

export const DnsLabelSchema = Type.String({
  pattern: DNS_LABEL_PATTERN,
  minLength: 1,
  maxLength: MAX_DNS_LABEL_LENGTH,
}) as BrandedSchema<TString, DnsLabel>;
