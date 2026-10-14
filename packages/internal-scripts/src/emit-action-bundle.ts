import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { $ } from 'bun';
import { repoRoot } from '#shared/paths.ts';

const actionDirectory = join(repoRoot, 'packages/deploy-action');
const outputDirectory = join(actionDirectory, 'dist');
const bundlePath = join(outputDirectory, 'index.mjs');
const result = await Bun.build({
  entrypoints: [join(actionDirectory, 'src/main.ts')],
  target: 'node',
  format: 'esm',
  minify: true,
  sourcemap: 'none',
});
if (!result.success || !result.outputs[0]) {
  throw new Error('Action bundle emission failed.', { cause: result.logs });
}
await mkdir(outputDirectory, { recursive: true });
await Bun.write(bundlePath, result.outputs[0]);
await $`node --check ${bundlePath}`;
