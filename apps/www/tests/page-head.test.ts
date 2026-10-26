import { expect, test } from 'bun:test';
import { pageHead } from '#lib/page-head.ts';

test('article metadata cannot close its JSON-LD script and preserves the original text', () => {
  const title = 'A </script><script> tag in an article title';
  const description = 'Content containing <markup> & special characters';
  const head = pageHead({
    path: '/blog/example',
    title,
    description,
    publishedAt: '2026-10-26',
  });
  const serialized = head.scripts[0]?.children;
  expect(serialized).toBeDefined();
  expect(serialized).not.toContain('<');
  expect(JSON.parse(serialized!)).toMatchObject({ headline: title, description });
});
