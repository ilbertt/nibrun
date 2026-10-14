import { mkdir } from 'node:fs/promises';

const packageDirectory = new URL('../', import.meta.url);
const outputDirectory = new URL('dist/', packageDirectory);
const result = await Bun.build({
  entrypoints: [new URL('src/main.ts', packageDirectory).pathname],
  target: 'node',
  format: 'esm',
  minify: true,
  sourcemap: 'none',
});
if (!result.success || !result.outputs[0]) {
  throw new Error('Action bundle emission failed.', { cause: result.logs });
}
await mkdir(outputDirectory, { recursive: true });
await Bun.write(new URL('index.mjs', outputDirectory), result.outputs[0]);
