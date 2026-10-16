import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BinaryLabel } from '#components/apps/binary-label.tsx';
import type { ArtifactSummary } from '#queries/artifacts.ts';
import type { DeploymentSummary } from '#queries/deployments.ts';

const SOURCE_URL = 'https://releases.example.com/v1/my-server.tar.gz';
const GITHUB: NonNullable<DeploymentSummary['github']> = {
  repository: 'ilbertt/nibrun',
  workflowRef: 'ilbertt/nibrun/.github/workflows/deploy.yml@refs/heads/main',
  ref: 'refs/heads/main',
  commitSha: 'b765447e50cceaf3268f44278940c4394d494cf9',
  runId: '123456789',
  runAttempt: '2',
};

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
  const markup = renderToStaticMarkup(
    <BinaryLabel artifact={artifact(SOURCE_URL)} github={undefined} mcp={undefined} />,
  );

  expect(markup).toContain('my-server');
  expect(markup).toContain('sha256:d9403d88cdf0');
  expect(markup).toContain(`href="${SOURCE_URL}"`);
  expect(markup).toContain(`aria-label="Binary source: ${SOURCE_URL}"`);
  expect(markup).toContain('target="_blank"');
  expect(markup).toContain('rel="noopener noreferrer"');
  expect(markup.indexOf('sha256:')).toBeLessThan(markup.indexOf('href='));
  expect(markup).not.toContain('Deployed by GitHub Actions');
});

test('uploaded binaries show their origin without a download link', () => {
  const markup = renderToStaticMarkup(
    <BinaryLabel artifact={artifact(undefined)} github={undefined} mcp={undefined} />,
  );

  expect(markup).toContain('my-server');
  expect(markup).toContain('sha256:d9403d88cdf0');
  expect(markup).toContain('aria-label="Uploaded binary"');
  expect(markup).not.toContain('href=');
});

test.each([undefined, SOURCE_URL])(
  'GitHub deployments retain the binary source and link to the verified workflow run attempt',
  (originalFileUrl) => {
    const binary = artifact(originalFileUrl);
    const markup = renderToStaticMarkup(
      <BinaryLabel artifact={binary} github={GITHUB} mcp={undefined} />,
    );
    const ownerDeployment = renderToStaticMarkup(
      <BinaryLabel artifact={binary} github={undefined} mcp={undefined} />,
    );

    expect(markup).toContain('my-server');
    expect(markup).toContain('sha256:d9403d88cdf0');
    expect(markup).toContain('aria-label="Deployed by GitHub Actions"');
    expect(markup).toContain(
      'href="https://github.com/ilbertt/nibrun/actions/runs/123456789/attempts/2"',
    );
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain(
      originalFileUrl === undefined
        ? 'aria-label="Uploaded binary"'
        : `aria-label="Binary source: ${SOURCE_URL}"`,
    );
    expect(ownerDeployment).not.toContain('Deployed by GitHub Actions');
    expect(ownerDeployment).not.toContain('github.com');
  },
);

test.each([undefined, SOURCE_URL])(
  'MCP provenance follows the release rather than the binary',
  (originalFileUrl) => {
    const binary = artifact(originalFileUrl);
    const clientId = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
    const markup = renderToStaticMarkup(
      <BinaryLabel artifact={binary} github={undefined} mcp={{ clientId }} />,
    );
    const manual = renderToStaticMarkup(
      <BinaryLabel artifact={binary} github={undefined} mcp={undefined} />,
    );
    const github = renderToStaticMarkup(
      <BinaryLabel artifact={binary} github={GITHUB} mcp={undefined} />,
    );
    expect(markup).toContain(`aria-label="Deployed via MCP: ${clientId}"`);
    expect(markup).toContain(
      originalFileUrl === undefined ? 'aria-label="Uploaded binary"' : `href="${SOURCE_URL}"`,
    );
    expect(manual).not.toContain('Deployed via MCP');
    expect(github).not.toContain('Deployed via MCP');
    expect(github).toContain('Deployed by GitHub Actions');
  },
);
