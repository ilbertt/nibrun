import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImageSourceFields } from '#components/deploy/image-source-fields.tsx';
import { imageSource } from '#tests/support/image-source.ts';

function ignoreChange(): void {}

test('image fields expose explicit startup paths and the pinned source', () => {
  const markup = renderToStaticMarkup(
    <ImageSourceFields value={imageSource()} invalid={false} onChange={ignoreChange} />,
  );
  expect(markup).toContain(imageSource().reference);
  expect(markup).toContain('value="/bin/busybox"');
  expect(markup).toContain('value="/app"');
  expect(markup).toContain('for="deploy-image-program"');
  expect(markup).toContain('for="deploy-image-directory"');
  expect(markup).toContain('unprivileged user');
});
