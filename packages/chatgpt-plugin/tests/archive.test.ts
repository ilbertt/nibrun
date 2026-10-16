import { expect, test } from 'bun:test';
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DASHBOARD_SITE, PRODUCT_NAME } from '@repo/global-constants';
import { strFromU8, unzipSync } from 'fflate';
import { createPluginArchive } from '#archive.ts';
import packageJson from '../package.json' with { type: 'json' };

const PACKAGE_DIRECTORY = resolve(import.meta.dir, '..');
const APP_ID = 'asdk_app_test';

test('submission ZIP contains the remote endpoint without a private app binding', async function submission() {
  const files = unzipSync(await createPluginArchive({ appId: undefined }));
  const manifest = JSON.parse(strFromU8(files['plugin.json']!));
  const mcp = JSON.parse(strFromU8(files['mcp.json']!));

  expect(manifest.version).toBe(packageJson.version);
  expect(mcp.mcpServers[PRODUCT_NAME]).toEqual({
    type: 'streamable-http',
    url: new URL('/mcp', DASHBOARD_SITE.url).href,
  });
  expect(files['.app.json']).toBeUndefined();
  expect(manifest.extensions['com.openai'].apps).toBeUndefined();
  expect(manifest.extensions['com.openai'].review).toBeUndefined();
});

test('private web ZIP references the app without desktop-only MCP declarations', async function privateWeb() {
  const files = unzipSync(await createPluginArchive({ appId: APP_ID }));
  const manifest = JSON.parse(strFromU8(files['plugin.json']!));

  expect(JSON.parse(strFromU8(files['.app.json']!))).toEqual({
    apps: { [PRODUCT_NAME]: { id: APP_ID, required: true } },
  });
  expect(manifest.extensions['com.openai'].apps).toBe('./.app.json');
  expect(manifest.extensions['com.openai'].requires_local_executor).toBe(false);
  expect(manifest.extensions['com.openai'].review).toBeUndefined();
  expect(files['mcp.json']).toBeUndefined();
  expect(files['.mcp.json']).toBeUndefined();
});

test('symlinked skills and icons become self-contained files in the ZIP', async function sharedAssets() {
  const files = unzipSync(await createPluginArchive({ appId: undefined }));
  const manifest = JSON.parse(strFromU8(files['plugin.json']!));

  expect((await lstat(joinPackagePath('skills'))).isSymbolicLink()).toBe(true);
  for (const path of ['assets/logo.png', 'assets/composer-icon.png']) {
    expect((await lstat(joinPackagePath(path))).isSymbolicLink()).toBe(true);
  }
  for (const path of [
    'skills/setup-app/SKILL.md',
    'skills/deploy-to-nibrun/SKILL.md',
    manifest.extensions['com.openai'].interface.logo.slice(2),
    manifest.extensions['com.openai'].interface.composerIcon.slice(2),
  ]) {
    expect(files[path]).toEqual(
      new Uint8Array(await Bun.file(joinPackagePath(path)).arrayBuffer()),
    );
  }
  expect(strFromU8(files['skills/setup-app/SKILL.md']!)).toContain('../deploy-to-nibrun/SKILL.md');
});

test('identical inputs produce the same archive', async function reproducibleArchive() {
  expect(await createPluginArchive({ appId: undefined })).toEqual(
    await createPluginArchive({ appId: undefined }),
  );
});

test.each(['', 'plugin_test', 'Plugin_test', 'https://app.nibrun.com/mcp'])(
  'rejects an invalid app reference: %s',
  async function invalidAppId(appId) {
    await expect(createPluginArchive({ appId })).rejects.toThrow('existing OpenAI app ID');
  },
);

function joinPackagePath(path: string): string {
  return resolve(PACKAGE_DIRECTORY, path);
}
