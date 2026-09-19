import { HELLO_EMAIL } from '@repo/global-constants';

const BODY = "Hi,\n\nI'd like to know more.\n\nThanks!";

// Percent-encoded rather than form-encoded: a mail client reads `+` in these as a plus sign
// rather than a space, so `URLSearchParams` would put one in every subject it wrote.
export function contactUrl(subject: string): string {
  const query = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(BODY)}`;
  return `mailto:${HELLO_EMAIL}?${query}`;
}
