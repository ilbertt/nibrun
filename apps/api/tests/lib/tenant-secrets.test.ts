import { describe, expect, test } from 'bun:test';
import { openSecret, readSecretsKey, sealedFromStore, sealSecret } from '#lib/tenant-secrets.ts';

const KEY_BYTES = 32;
const SHORT_KEY_BYTES = 16;
const VALUE = '/app/data/.openclaw-runtime';
// Enough of the tail to land inside the ciphertext rather than on the envelope around it.
const EDITED_CHARS = 4;

function key(fill = 'k') {
  return readSecretsKey(Buffer.from(fill.repeat(KEY_BYTES)).toString('base64'));
}

test('a sealed secret comes back as what went in', () => {
  const sealed = sealSecret({ key: key(), plaintext: VALUE });

  expect(sealed).not.toContain(VALUE);
  expect(openSecret({ key: key(), sealed })).toBe(VALUE);
});

test('an empty value is a value, not an absence', () => {
  const sealed = sealSecret({ key: key(), plaintext: '' });

  expect(openSecret({ key: key(), sealed })).toBe('');
});

// Two apps setting the same variable to the same secret must not be visible as the same
// ciphertext, which is also what keeps the iv from ever repeating under one key.
test('the same value sealed twice is two different ciphertexts', () => {
  expect(sealSecret({ key: key(), plaintext: VALUE })).not.toBe(
    sealSecret({ key: key(), plaintext: VALUE }),
  );
});

describe('what will not open', () => {
  test('a value edited after it was sealed', () => {
    const sealed = sealSecret({ key: key(), plaintext: VALUE });
    const edited = `${sealed.slice(0, -EDITED_CHARS)}AAAA`;

    expect(() => openSecret({ key: key(), sealed: sealedFromStore(edited) })).toThrow();
  });

  test('a value sealed under another key', () => {
    const sealed = sealSecret({ key: key('k'), plaintext: VALUE });

    expect(() => openSecret({ key: key('j'), sealed })).toThrow();
  });

  test('a value stamped with a scheme this does not know', () => {
    const sealed = sealSecret({ key: key(), plaintext: VALUE });

    expect(() =>
      openSecret({ key: key(), sealed: sealedFromStore(sealed.replace('v1.', 'v2.')) }),
    ).toThrow('not written by a scheme this knows');
  });

  test('something that was never a sealed secret at all', () => {
    expect(() => openSecret({ key: key(), sealed: sealedFromStore(VALUE) })).toThrow();
  });
});

test('a key of the wrong length is refused where it is read, not where it is used', () => {
  const short = Buffer.from('k'.repeat(SHORT_KEY_BYTES)).toString('base64');

  expect(() => readSecretsKey(short)).toThrow('must be 32 bytes');
});
