import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { BadRequestError } from '#lib/errors.ts';

const SSH_DEPLOY_KEY_ALGORITHM = 'ssh-ed25519';
const SSH_STRING_LENGTH_BYTES = 4;
const ED25519_PUBLIC_KEY_BYTES = 32;
const ALGORITHM_BYTES = Buffer.from(SSH_DEPLOY_KEY_ALGORITHM);
const KEY_LENGTH_OFFSET = SSH_STRING_LENGTH_BYTES + ALGORITHM_BYTES.byteLength;
const KEY_OFFSET = KEY_LENGTH_OFFSET + SSH_STRING_LENGTH_BYTES;
const KEY_BLOB_BYTES = KEY_OFFSET + ED25519_PUBLIC_KEY_BYTES;
const PUBLIC_KEY_PATTERN = new RegExp(
  `^${SSH_DEPLOY_KEY_ALGORITHM}[ \\t]+([A-Za-z0-9+/]+={0,2})(?:[ \\t]+[^\\r\\n]*)?$`,
);
const INVALID_PUBLIC_KEY = 'Provide an OpenSSH Ed25519 public key, starting with ssh-ed25519.';

export function parseSshPublicKey(source: string): { publicKey: string; fingerprint: string } {
  const encoded = PUBLIC_KEY_PATTERN.exec(source.trim())?.[1];
  if (!encoded) {
    throw new BadRequestError(INVALID_PUBLIC_KEY);
  }
  const blob = Buffer.from(encoded, 'base64');
  if (!isEd25519KeyBlob(blob) || blob.toString('base64') !== encoded) {
    throw new BadRequestError(INVALID_PUBLIC_KEY);
  }
  return {
    publicKey: `${SSH_DEPLOY_KEY_ALGORITHM} ${encoded}`,
    fingerprint: `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`,
  };
}

function isEd25519KeyBlob(blob: Buffer): boolean {
  return (
    blob.byteLength === KEY_BLOB_BYTES &&
    blob.readUInt32BE(0) === ALGORITHM_BYTES.byteLength &&
    blob.subarray(SSH_STRING_LENGTH_BYTES, KEY_LENGTH_OFFSET).equals(ALGORITHM_BYTES) &&
    blob.readUInt32BE(KEY_LENGTH_OFFSET) === ED25519_PUBLIC_KEY_BYTES
  );
}
