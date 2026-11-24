import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { setupBrowserLocation } from '#tests/support/browser.ts';

setupBrowserLocation();
const { AppVolume } = await import('#components/apps/app-volume.tsx');

test('an app on customer storage shows its exact bucket location', () => {
  const html = renderToStaticMarkup(
    <AppVolume storage={{ bucket: 'customer', prefix: 'apps/app-1' }} />,
  );
  expect(html).toContain('s3://customer/apps/app-1');
  expect(html).not.toContain('Use your bucket');
});
