import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Brand } from '@repo/protocol';
import { type TenantEnvironment, TenantEnvironmentSchema, Value } from '@repo/protocol';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

// Stamped on every sealed value so the day a second scheme exists, the ones written under this
// one still say which they are. Nothing reads it but the check below — that is the point.
const ENVELOPE_VERSION = 'v1';
const ENVELOPE_SEPARATOR = '.';

export type TenantSecretsKey = Brand<Buffer, 'TenantSecretsKey'>;

/**
 * Ciphertext, as against the plaintext it was made from and the `[redacted]` an owner reads back.
 * Branded because all three are strings, and only one of them may reach the database — a shape
 * the type system would otherwise let any of them satisfy.
 */
export type SealedSecret = Brand<string, 'SealedSecret'>;

export type SealedEnvironment = Record<string, SealedSecret>;

/**
 * The one place a plain string is taken as ciphertext: a column this api wrote and is reading
 * back. Everywhere else the brand is what refuses a value that was never sealed.
 */
export function sealedFromStore(value: string): SealedSecret {
  return value as SealedSecret;
}

/**
 * One relation, many rows per owner, whether that owner is a deployment about to run or an export
 * about to be written. What the two share is the shape of a stored environment rather than the id
 * it hangs off, so the id is the caller's to name.
 */
export function sealedEnvironmentBy<Row extends { name: string; value: string }>({
  rows,
  owner,
}: {
  rows: readonly Row[];
  owner: (row: Row) => string;
}): Map<string, SealedEnvironment> {
  const byOwner = new Map<string, SealedEnvironment>();
  for (const row of rows) {
    const id = owner(row);
    // Written into the object already there rather than into a copy of it, so an owner with many
    // variables costs one pass and not one object per row.
    const environment = byOwner.get(id) ?? {};
    environment[row.name] = sealedFromStore(row.value);
    byOwner.set(id, environment);
  }
  return byOwner;
}

/**
 * The key an owner's environment variables are sealed with, from its base64 in the environment.
 *
 * Its length is the cipher's rather than a preference, so a key of any other size is a
 * deployment that would otherwise fail on the first secret written rather than at boot.
 */
export function readSecretsKey(base64: string): TenantSecretsKey {
  const key = Buffer.from(base64, 'base64');
  if (key.byteLength !== KEY_BYTES) {
    throw new Error(
      `TENANT_SECRETS_KEY must be ${KEY_BYTES} bytes base64-encoded, got ${key.byteLength}.`,
    );
  }
  return key as TenantSecretsKey;
}

/**
 * A fresh iv per value, never derived from the value or its name: reusing one under the same key
 * is what breaks GCM, and two apps setting the same variable to the same secret must not be
 * visible as the same ciphertext.
 */
export function sealSecret({
  key,
  plaintext,
}: {
  key: TenantSecretsKey;
  plaintext: string;
}): SealedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const sealed = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    ENVELOPE_VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    sealed.toString('base64'),
  ].join(ENVELOPE_SEPARATOR) as SealedSecret;
}

/**
 * Raises rather than returning anything for a value it cannot open. These come from this end's
 * own database, so a failure is the key having changed or the row having been written by
 * something else — and a tenant started with the wrong environment is worse than one not started.
 */
export function openSecret({
  key,
  sealed,
}: {
  key: TenantSecretsKey;
  sealed: SealedSecret;
}): string {
  const [version, iv, tag, ciphertext] = sealed.split(ENVELOPE_SEPARATOR);
  if (version !== ENVELOPE_VERSION || iv === undefined || tag === undefined) {
    throw new Error('A sealed secret was not written by a scheme this knows.');
  }

  const authTag = Buffer.from(tag, 'base64');
  if (authTag.byteLength !== TAG_BYTES) {
    throw new Error('A sealed secret carries no usable authentication tag.');
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(authTag);
  return (
    decipher.update(Buffer.from(ciphertext ?? '', 'base64')).toString('utf8') +
    decipher.final('utf8')
  );
}

/** Names are left as they are: an owner is told which variables are set, never what they hold. */
export function sealEnvironment({
  key,
  environment,
}: {
  key: TenantSecretsKey;
  environment: TenantEnvironment;
}): SealedEnvironment {
  return Object.fromEntries(
    Object.entries(environment).map(([name, value]) => [
      name,
      sealSecret({ key, plaintext: value }),
    ]),
  );
}

export function openEnvironment({
  key,
  sealed,
}: {
  key: TenantSecretsKey;
  sealed: SealedEnvironment;
}): TenantEnvironment {
  const opened = Object.fromEntries(
    Object.entries(sealed).map(([name, value]) => [name, openSecret({ key, sealed: value })]),
  );

  // Checked before it is parsed, never by parsing: parsing drops a name the schema does not allow
  // and then succeeds, which would hand a host an environment quietly missing a variable its
  // owner set. The column has a CHECK saying the same thing, so reaching this is a row written by
  // something other than this api.
  if (!Value.Check(TenantEnvironmentSchema, opened)) {
    throw new Error('A stored environment holds a name this api would not have written.');
  }
  return Value.Parse(TenantEnvironmentSchema, opened);
}
