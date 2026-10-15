import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { OAuthConsentButtons } from '#components/oauth/oauth-consent-buttons.tsx';

function onDecide() {}

test('a verified request offers both approval and denial', () => {
  const markup = renderToStaticMarkup(
    <OAuthConsentButtons redirecting={false} onDecide={onDecide} />,
  );
  expect(markup).toContain('Deny');
  expect(markup).toContain('Allow access');
  expect(markup).not.toContain('disabled=""');
});

test('neither decision can be resubmitted while saving or redirecting', () => {
  const markup = renderToStaticMarkup(<OAuthConsentButtons redirecting onDecide={onDecide} />);
  const buttons = [...markup.matchAll(/<button[^>]+>/g)].map((match) => match[0]);
  expect(buttons).toHaveLength(2);
  expect(buttons.every((button) => button.includes('disabled=""'))).toBe(true);
  expect(markup).toContain('Redirecting…');
  expect(markup).not.toContain('Allow access');
});
