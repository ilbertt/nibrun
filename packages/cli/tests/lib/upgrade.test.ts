import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installedBinary, runInstallScript } from '#lib/upgrade.ts';

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * These tests run from source, which is the case `installedBinary` exists to catch: `execPath` here
 * is Bun, and replacing Bun with a nib is not what an upgrade was ever asking for.
 */
test('a nib running from source has nothing to upgrade', () => {
  expect(() => installedBinary()).toThrow('runs from source');
});

// The one thing the script is told, and the whole reason this runs it rather than an owner: the
// directory the install writes to is the one the nib running the upgrade is in.
test('the install is pointed at the directory the running nib is in', async () => {
  const dir = await scratchDir();
  const reported = join(dir, 'install-dir');

  await runInstallScript({
    script: `printf '%s' "$NIB_INSTALL_DIR" > ${reported}`,
    installDir: dir,
  });

  expect(await Bun.file(reported).text()).toBe(dir);
});

// The script says what went wrong on the way past; what this adds is that it was not an upgrade.
test('an install that does not finish is not reported as one that did', async () => {
  const dir = await scratchDir();

  await expect(runInstallScript({ script: 'exit 1', installDir: dir })).rejects.toThrow(
    'nib was not replaced',
  );
});

async function scratchDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nib-upgrade-'));
  dirs.push(dir);
  return dir;
}
