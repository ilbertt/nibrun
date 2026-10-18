import { readdir, stat } from 'node:fs/promises';
import { join, posix, resolve } from 'node:path';
import { DASHBOARD_SITE, PRODUCT_NAME } from '@repo/global-constants';
import { strToU8, zipSync } from 'fflate';
import { createManifest } from '#manifest.ts';

const PACKAGE_DIRECTORY = resolve(import.meta.dir, '..');
const ZIP_MTIME = new Date('1980-01-01T00:00:00');
const JSON_INDENT = 2;
const ZIP_COMPRESSION_LEVEL = 9;

type ArchiveFiles = Record<string, Uint8Array>;

export async function createPluginArchive() {
  const files: ArchiveFiles = {
    'plugin.json': jsonBytes(createManifest()),
    'mcp.json': jsonBytes({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: {
        [PRODUCT_NAME]: {
          type: 'streamable-http',
          url: new URL('/mcp', DASHBOARD_SITE.url).href,
        },
      },
    }),
  };
  for (const directory of ['skills', 'assets']) {
    await addDirectory({
      files,
      directory: join(PACKAGE_DIRECTORY, directory),
      archivePath: directory,
    });
  }

  return zipSync(files, { level: ZIP_COMPRESSION_LEVEL, mtime: ZIP_MTIME });
}

function jsonBytes(value: unknown): Uint8Array {
  return strToU8(`${JSON.stringify(value, null, JSON_INDENT)}\n`);
}

async function addDirectory({
  files,
  directory,
  archivePath,
}: {
  files: ArchiveFiles;
  directory: string;
  archivePath: string;
}): Promise<void> {
  for (const name of (await readdir(directory)).sort()) {
    const filePath = join(directory, name);
    const entryPath = posix.join(archivePath, name);
    if ((await stat(filePath)).isDirectory()) {
      await addDirectory({ files, directory: filePath, archivePath: entryPath });
    } else {
      files[entryPath] = new Uint8Array(await Bun.file(filePath).arrayBuffer());
    }
  }
}
