import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BinaryLabel } from '#components/apps/binary-label.tsx';
import type { ArtifactSummary } from '#queries/artifacts.ts';

const SOURCE_URL = 'https://releases.example.com/v1/my-server.tar.gz';

function artifact(originalFileUrl: ArtifactSummary['originalFileUrl']): ArtifactSummary {
  return {
    id: '0199c0de-0000-7000-8000-000000000002',
    appId: '0199c0de-0000-7000-8000-000000000001',
    digest: 'd9403d88cdf0684fbb9d8e97cf3508e9fb4506cf309a34e42653a1c2bc04a298',
    sizeBytes: 1024,
    objectKey: 'binary',
    originalFileName: 'my-server',
    originalFileUrl,
    createdAt: '2026-10-08T09:00:00.000Z',
  };
}

test('downloaded binaries link to their original source beside the name and SHA', () => {
  const markup = renderToStaticMarkup(<BinaryLabel artifact={artifact(SOURCE_URL)} />);

  expect(markup).toContain('my-server');
  expect(markup).toContain('sha256:d9403d88cdf0');
  expect(markup).toContain(`href="${SOURCE_URL}"`);
  expect(markup).toContain(`aria-label="Binary source: ${SOURCE_URL}"`);
  expect(markup).toContain('target="_blank"');
  expect(markup).toContain('rel="noopener noreferrer"');
  expect(markup.indexOf('sha256:')).toBeLessThan(markup.indexOf('href='));
});

test('uploaded binaries show their origin without a download link', () => {
  const markup = renderToStaticMarkup(<BinaryLabel artifact={artifact(undefined)} />);

  expect(markup).toContain('my-server');
  expect(markup).toContain('sha256:d9403d88cdf0');
  expect(markup).toContain('aria-label="Uploaded binary"');
  expect(markup).not.toContain('href=');
});
