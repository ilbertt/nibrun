import { type DnsLabel, DnsLabelSchema, MAX_DNS_LABEL_LENGTH, Value } from '@repo/protocol';

const SEPARATOR = '-';

// Crockford base32: no I, L, O or U. The suffix is the part of a URL that gets read down a
// phone, so the characters that are ambiguous out loud are gone — and dropping U takes most
// accidental profanity out of the random part with it.
const SUFFIX_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const SUFFIX_LENGTH = 6;

const MAX_STEM_LENGTH = MAX_DNS_LABEL_LENGTH - SUFFIX_LENGTH - SEPARATOR.length;

// A name of only emoji, CJK or punctuation slugifies to nothing, and every one of those is a
// name a user is allowed to pick. Creation must not fail on it.
const FALLBACK_STEM = 'app';

// Reserved by IDNA: a label starting with it announces itself as an encoded Unicode name, and
// resolvers are entitled to read it as one.
const PUNYCODE_PREFIX = 'xn--';

const COMBINING_MARKS = /\p{M}+/gu;
const ILLEGAL_RUN = /[^a-z0-9-]+/g;
const LEADING_HYPHENS = /^-+/;
const TRAILING_HYPHENS = /-+$/;

/**
 * Derives the DNS label an app is served under from the name its owner gave it.
 *
 * The label is a snapshot taken once, at creation, and never recomputed: by the time an app is
 * renamed its URL is in somebody else's bookmarks, and a URL that moves is a broken one. The
 * random suffix is what makes taking that snapshot safe — two owners naming an app the same
 * thing get two labels rather than a collision.
 */
export function deriveAppSlug(name: string): DnsLabel {
  return Value.Parse(DnsLabelSchema, `${stemOf(name)}${SEPARATOR}${randomSuffix()}`);
}

function stemOf(name: string): string {
  const slugified = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(ILLEGAL_RUN, SEPARATOR)
    .replace(LEADING_HYPHENS, '')
    .replace(TRAILING_HYPHENS, '');

  if (slugified.length === 0 || slugified.startsWith(PUNYCODE_PREFIX)) {
    return FALLBACK_STEM;
  }

  // Only the stem gives way to the length budget, and truncation can land on a hyphen that
  // would then double up against the separator.
  return slugified.slice(0, MAX_STEM_LENGTH).replace(TRAILING_HYPHENS, '');
}

// The alphabet divides 256 exactly, so a byte modulo it is uniform and needs no resampling.
const suffixCharacter = (byte: number) => SUFFIX_ALPHABET.charAt(byte % SUFFIX_ALPHABET.length);

function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SUFFIX_LENGTH));
  return Array.from(bytes, suffixCharacter).join('');
}
