import { describe, expect, test } from 'bun:test';
import { isValidMessage, ObjectKeySchema, Sha256DigestSchema, Value } from '@repo/protocol';
import { identifyArtifact } from '#lib/artifact-digest.ts';

// From the SHA-256 test vectors: the digest of the empty input and of "abc".
const EMPTY_DIGEST = Value.Parse(
  Sha256DigestSchema,
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
);
const ABC_DIGEST = Value.Parse(
  Sha256DigestSchema,
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
);

// One character, two bytes — which is the whole point of the size test below.
const MULTI_BYTE_CHARACTER = 'é';
const MULTI_BYTE_CHARACTER_SIZE = 2;

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('an artifact is identified by what was stored, not by what was claimed', () => {
  test('the digest is the SHA-256 of the bytes', () => {
    expect(identifyArtifact(bytesOf('abc')).digest).toBe(ABC_DIGEST);
    expect(identifyArtifact(new Uint8Array()).digest).toBe(EMPTY_DIGEST);
  });

  test('the size is the byte length, not the character count', () => {
    expect(identifyArtifact(bytesOf(MULTI_BYTE_CHARACTER)).sizeBytes).toBe(
      MULTI_BYTE_CHARACTER_SIZE,
    );
  });

  test('the same bytes always land on the same object key', () => {
    expect(identifyArtifact(bytesOf('abc')).objectKey).toBe(
      identifyArtifact(bytesOf('abc')).objectKey,
    );
  });

  test('bytes that differ anywhere land somewhere else', () => {
    expect(identifyArtifact(bytesOf('abc')).objectKey).not.toBe(
      identifyArtifact(bytesOf('abd')).objectKey,
    );
  });

  test('the key names the digest algorithm, so a future one cannot alias this object', () => {
    expect(identifyArtifact(bytesOf('abc')).objectKey).toBe(
      Value.Parse(ObjectKeySchema, ABC_DIGEST),
    );
  });

  test('the identity satisfies the schemas the agent will read it back through', () => {
    const { digest, objectKey } = identifyArtifact(bytesOf('abc'));

    expect(isValidMessage({ schema: Sha256DigestSchema, value: digest })).toBe(true);
    expect(isValidMessage({ schema: ObjectKeySchema, value: objectKey })).toBe(true);
  });
});
