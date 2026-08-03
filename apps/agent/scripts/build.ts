import { rm } from 'node:fs/promises';
import { join } from 'node:path';

const AGENT_DIR = join(import.meta.dir, '..');
const AGENT_DIST_DIR = join(AGENT_DIR, 'dist');
const AGENT_BINARY_FILE = join(AGENT_DIST_DIR, 'nibrun-agent');
const AGENT_ENTRYPOINT = 'src/index.ts';

// App hosts are x86_64 Linux, and the target names a *released* Bun rather than whichever one
// runs the build: a canary has no published Linux download, so an unpinned target turns "the
// developer is on a canary" into a broken deploy instead of a build error. The version tracks
// `.bun-version`, and the type does not describe the versioned form the CLI accepts.
const AGENT_COMPILE_TARGET = 'bun-v1.3.14-linux-x64' as unknown as Bun.Build.CompileTarget;

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
