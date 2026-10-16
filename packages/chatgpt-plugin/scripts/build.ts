import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PRODUCT_NAME } from '@repo/global-constants';
import { createPluginArchive } from '#archive.ts';
import packageJson from '../package.json' with { type: 'json' };

const archive = await createPluginArchive();
const directory = resolve(import.meta.dir, '..', 'dist');
const filename = `${PRODUCT_NAME}-submission-${packageJson.version}.zip`;
const checksum = new Bun.CryptoHasher('sha256').update(archive).digest('hex');

await mkdir(directory, { recursive: true });
await Bun.write(join(directory, filename), archive);
await Bun.write(join(directory, `${filename}.sha256`), `${checksum}  ${filename}\n`);
console.log(`Created ${join(directory, filename)}`);
