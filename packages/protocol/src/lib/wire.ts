import { type TInteger, type TString, Type } from '@sinclair/typebox';
import type { Brand, BrandedSchema } from '#lib/brand.ts';

// Every schema in this package resolves to one of these. The wire format is JSON and only
// JSON: ISO strings for timestamps, hex for digests, numbers for sizes. Conversion to richer
// types happens explicitly at the edge that wants them, never implicitly in here.

const MAX_IDENTIFIER_LENGTH = 63;
const IDENTIFIER_PATTERN = '^[0-9A-Za-z][0-9A-Za-z_-]{0,62}$';

const SHA256_HEX_PATTERN = '^[0-9a-f]{64}$';
const SHA256_HEX_LENGTH = 64;

// Offset is mandatory: a local time with no offset is the failure this pattern exists to
// catch, and it is the one a lenient parser turns into a silently wrong instant. Calendar
// validity is not checked — a well-formed 31st of February is not the skew this guards.
const TIMESTAMP_PATTERN =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,9})?(Z|[+-]\\d{2}:\\d{2})$';
const MAX_TIMESTAMP_LENGTH = 35;

const DNS_LABEL_PATTERN = '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$';
const MAX_DNS_LABEL_LENGTH = 63;

const HOSTNAME_PATTERN =
  '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$';
const MAX_HOSTNAME_LENGTH = 253;

const IPV4_OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_PATTERN = `^(${IPV4_OCTET}\\.){3}${IPV4_OCTET}$`;
const MAX_IPV4_LENGTH = 15;

const MAX_OBJECT_KEY_LENGTH = 1024;

const MIN_PORT = 1;
const MAX_PORT = 65_535;

export type Identifier<Name extends string> = Brand<string, Name>;

export const identifierSchema = <Value extends Identifier<string>>(description: string) =>
  Type.String({
    description,
    pattern: IDENTIFIER_PATTERN,
    minLength: 1,
    maxLength: MAX_IDENTIFIER_LENGTH,
  }) as BrandedSchema<TString, Value>;

export type Timestamp = Brand<string, 'Timestamp'>;

export const TimestampSchema = Type.String({
  description: 'ISO 8601 instant with a mandatory UTC offset.',
  pattern: TIMESTAMP_PATTERN,
  maxLength: MAX_TIMESTAMP_LENGTH,
}) as BrandedSchema<TString, Timestamp>;

export type Sha256Digest = Brand<string, 'Sha256Digest'>;

export const Sha256DigestSchema = Type.String({
  description: 'Lowercase hex SHA-256, unprefixed.',
  pattern: SHA256_HEX_PATTERN,
  minLength: SHA256_HEX_LENGTH,
  maxLength: SHA256_HEX_LENGTH,
}) as BrandedSchema<TString, Sha256Digest>;

export const ByteSizeSchema = Type.Integer({ minimum: 0 });

export type DnsLabel = Brand<string, 'DnsLabel'>;

export const DnsLabelSchema = Type.String({
  pattern: DNS_LABEL_PATTERN,
  minLength: 1,
  maxLength: MAX_DNS_LABEL_LENGTH,
}) as BrandedSchema<TString, DnsLabel>;

export type Hostname = Brand<string, 'Hostname'>;

export const HostnameSchema = Type.String({
  pattern: HOSTNAME_PATTERN,
  maxLength: MAX_HOSTNAME_LENGTH,
}) as BrandedSchema<TString, Hostname>;

export type Ipv4Address = Brand<string, 'Ipv4Address'>;

export const Ipv4AddressSchema = Type.String({
  pattern: IPV4_PATTERN,
  maxLength: MAX_IPV4_LENGTH,
}) as BrandedSchema<TString, Ipv4Address>;

export type ObjectKey = Brand<string, 'ObjectKey'>;

export const ObjectKeySchema = Type.String({
  description: 'Key within a bucket. Which bucket is deploy configuration, not protocol.',
  minLength: 1,
  maxLength: MAX_OBJECT_KEY_LENGTH,
}) as BrandedSchema<TString, ObjectKey>;

// The port the tenant's binary listens on inside its guest, and the port the agent forwards
// to it on the host, are different numbers that mean different things. They are branded
// apart so that assigning one to the other is a type error rather than a routing bug.
export type GuestPort = Brand<number, 'GuestPort'>;

export const GuestPortSchema = Type.Integer({
  description: 'Port the tenant binary listens on inside the guest.',
  minimum: MIN_PORT,
  maximum: MAX_PORT,
}) as BrandedSchema<TInteger, GuestPort>;

export type HostPort = Brand<number, 'HostPort'>;

export const HostPortSchema = Type.Integer({
  description: 'Port on the app host that forwards to an instance. Allocated by the agent.',
  minimum: MIN_PORT,
  maximum: MAX_PORT,
}) as BrandedSchema<TInteger, HostPort>;

export const DEFAULT_GUEST_PORT = 3000 as GuestPort;
