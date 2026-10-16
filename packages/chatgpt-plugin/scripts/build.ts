import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PRODUCT_NAME } from '@repo/global-constants';
import { createPluginArchive } from '#archive.ts';
import packageJson from '../package.json' with { type: 'json' };

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { 'app-id': { type: 'string' } },
});
const appId = values['app-id'];
const archive = await createPluginArchive({ appId });
const directory = resolve(import.meta.dir, '..', 'dist');
const target = appId === undefined ? 'submission' : 'private-web';
const filename = `${PRODUCT_NAME}-${target}-${packageJson.version}.zip`;
const checksum = new Bun.CryptoHasher('sha256').update(archive).digest('hex');

await mkdir(directory, { recursive: true });
await Bun.write(join(directory, filename), archive);
await Bun.write(join(directory, `${filename}.sha256`), `${checksum}  ${filename}\n`);
console.log(`Created ${join(directory, filename)}`);
