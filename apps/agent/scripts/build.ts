import { rm } from 'node:fs/promises';
import { join } from 'node:path';

const AGENT_DIR = join(import.meta.dir, '..');
const AGENT_DIST_DIR = join(AGENT_DIR, 'dist');
const AGENT_BINARY_FILE = join(AGENT_DIST_DIR, 'nibrun-agent');
const AGENT_ENTRYPOINT = 'src/index.ts';

// App hosts are x86_64 Linux, so this cross-compiles rather than taking the host it was built on.
const AGENT_COMPILE_TARGET = 'bun-linux-x64';

const FAILURE_EXIT_CODE = 1;

console.log('🧹 Cleaning dist dir...');
await rm(AGENT_DIST_DIR, { recursive: true, force: true });

console.log('🔨 Compiling binary...');
const buildResult = await Bun.build({
  entrypoints: [AGENT_ENTRYPOINT],
  compile: {
    outfile: AGENT_BINARY_FILE,
    target: AGENT_COMPILE_TARGET,
  },
  minify: { whitespace: true, syntax: true },
  target: 'bun',
});

if (!buildResult.success) {
  console.error('❌ Build failed:', JSON.stringify(buildResult, null, 2));
  process.exit(FAILURE_EXIT_CODE);
}

console.log('✅ Done');
