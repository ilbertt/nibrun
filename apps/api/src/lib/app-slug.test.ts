import { describe, expect, test } from 'bun:test';
import { DnsLabelSchema, isValidMessage, MAX_DNS_LABEL_LENGTH } from '@repo/protocol';
import { deriveAppSlug } from '#lib/app-slug.ts';

const SEPARATOR = '-';
const SUFFIX_LENGTH = 6;
const MAX_STEM_LENGTH = MAX_DNS_LABEL_LENGTH - SUFFIX_LENGTH - SEPARATOR.length;

// Restated rather than imported from the implementation: excluding I, L, O and U is the
// contract this file exists to hold it to, not a detail it should read back from it.
const CROCKFORD_BASE32 = '0123456789abcdefghjkmnpqrstvwxyz';
const AMBIGUOUS_CHARACTERS = ['i', 'l', 'o', 'u'];

const SAMPLE_SIZE = 200;
const OVERLONG_NAME_LENGTH = 200;

// The hyphen lands on the last slot of the stem budget, so truncating stops right on it.
const TRUNCATED_ONTO_HYPHEN = `${'a'.repeat(MAX_STEM_LENGTH - SEPARATOR.length)} ${'b'.repeat(
  MAX_STEM_LENGTH,
)}`;

const stemOf = (label: string) => label.slice(0, label.lastIndexOf(SEPARATOR));
const suffixOf = (label: string) => label.slice(label.lastIndexOf(SEPARATOR) + 1);

const isDnsLabel = (label: string) => isValidMessage({ schema: DnsLabelSchema, value: label });

describe('the stem carries the name it came from', () => {
  test('a name that is already a label survives intact', () => {
    expect(stemOf(deriveAppSlug('pocketbase'))).toBe('pocketbase');
  });

  test('case, spaces and punctuation collapse into hyphens', () => {
    expect(stemOf(deriveAppSlug('My Great App!'))).toBe('my-great-app');
    expect(stemOf(deriveAppSlug('  --Trimmed--  '))).toBe('trimmed');
    expect(stemOf(deriveAppSlug('Café Résumé'))).toBe('cafe-resume');
  });
});

describe('a name that slugifies to nothing still gets a label', () => {
  test('emoji only', () => {
    expect(stemOf(deriveAppSlug('🎉🎉🎉'))).toBe('app');
  });

  test('CJK only', () => {
    expect(stemOf(deriveAppSlug('日本語のアプリ'))).toBe('app');
  });

  test('punctuation only', () => {
    expect(stemOf(deriveAppSlug('!!! ??? ...'))).toBe('app');
  });
});

test('a name that would slugify to a punycode prefix is neutralised', () => {
  expect(stemOf(deriveAppSlug('xn--n3h'))).toBe('app');
  expect(stemOf(deriveAppSlug('XN--Mgbh0fb'))).toBe('app');
});

describe('the length budget', () => {
  test('an overlong name is truncated to fit', () => {
    const label = deriveAppSlug('a'.repeat(OVERLONG_NAME_LENGTH));

    expect(label).toHaveLength(MAX_DNS_LABEL_LENGTH);
    expect(stemOf(label)).toBe('a'.repeat(MAX_STEM_LENGTH));
  });

  test('truncating onto a hyphen does not leave one', () => {
    const label = deriveAppSlug(TRUNCATED_ONTO_HYPHEN);

    expect(stemOf(label)).toBe('a'.repeat(MAX_STEM_LENGTH - SEPARATOR.length));
    expect(stemOf(label).endsWith(SEPARATOR)).toBe(false);
    expect(isDnsLabel(label)).toBe(true);
  });

  test('the suffix keeps its full length whatever the name costs', () => {
    expect(suffixOf(deriveAppSlug('a'.repeat(OVERLONG_NAME_LENGTH)))).toHaveLength(SUFFIX_LENGTH);
    expect(suffixOf(deriveAppSlug('x'))).toHaveLength(SUFFIX_LENGTH);
  });
});

describe('the suffix', () => {
  const sampled = Array.from({ length: SAMPLE_SIZE }, () => suffixOf(deriveAppSlug('app'))).join(
    '',
  );

  test('is drawn only from Crockford base32', () => {
    for (const character of sampled) {
      expect(CROCKFORD_BASE32).toInclude(character);
    }
  });

  test('never contains I, L, O or U', () => {
    for (const character of AMBIGUOUS_CHARACTERS) {
      expect(sampled).not.toInclude(character);
    }
  });

  test('is what separates two apps sharing a name', () => {
    const first = deriveAppSlug('pocketbase');
    const second = deriveAppSlug('pocketbase');

    expect(stemOf(first)).toBe(stemOf(second));
    expect(first).not.toBe(second);
  });
});

test('every derived label satisfies DnsLabelSchema', () => {
  const names = [
    'pocketbase',
    'My Great App!',
    '  --Trimmed--  ',
    'Café Résumé',
    '🎉🎉🎉',
    '日本語のアプリ',
    '!!! ??? ...',
    'xn--n3h',
    'a'.repeat(OVERLONG_NAME_LENGTH),
    TRUNCATED_ONTO_HYPHEN,
    SEPARATOR.repeat(MAX_DNS_LABEL_LENGTH),
    ' ',
    '',
    'x',
    '9',
  ];

  for (const name of names) {
    expect(isDnsLabel(deriveAppSlug(name))).toBe(true);
  }
});
