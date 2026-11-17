import { expect, test } from 'bun:test';
import { artifactName, artifactProgram } from '#artifact.ts';

test('an image repository labels the release while its program starts the app', () => {
  const image = { repository: 'ghcr.io/owner/app', program: '/usr/local/bin/server' };
  expect(artifactName(image)).toBe('ghcr.io/owner/app');
  expect(artifactProgram(image)).toBe('/usr/local/bin/server');
});

test('uploaded binaries keep their original executable name', () => {
  const binary = { originalFileName: 'my-server' };
  expect(artifactName(binary)).toBe('my-server');
  expect(artifactProgram(binary)).toBe('my-server');
});
