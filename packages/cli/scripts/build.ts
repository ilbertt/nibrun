import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PROGRAM_NAME } from '#config.ts';

const CLI_DIR = join(import.meta.dir, '..');
const DIST_DIR = join(CLI_DIR, 'dist');
const BUN_VERSION_FILE = join(CLI_DIR, '../../.bun-version');
const ENTRYPOINT = 'src/main.ts';

// Every platform a release carries an asset for. An owner downloads one of these by name, so a
// suffix here is the asset's identity rather than an implementation detail of the compile target.
const RELEASE_PLATFORMS = ['darwin-arm64', 'linux-x64', 'linux-arm64'] as const;

const FAILURE_EXIT_CODE = 1;

// The target pins the released Bun `.bun-version` names rather than resolving to whichever one
// runs the build. Left unversioned, Bun embeds its own version and downloads it for every platform
// that is not the host — and CI upgrades to a canary after installing, which publishes no such
// download, so two of these three would fail there. The versioned form is undocumented, and the
// type does not describe it.
const bunVersion = (await Bun.file(BUN_VERSION_FILE).text()).trim();

console.log('🧹 Cleaning dist dir...');
await rm(DIST_DIR, { recursive: true, force: true });

for (const platform of RELEASE_PLATFORMS) {
  const binaryName = `${PROGRAM_NAME}-${platform}`;

  console.log(`🔨 Compiling ${binaryName}...`);
  const buildResult = await Bun.build({
    entrypoints: [ENTRYPOINT],
    compile: {
      outfile: join(DIST_DIR, binaryName),
      target: `bun-v${bunVersion}-${platform}` as unknown as Bun.Build.CompileTarget,
    },
    minify: { whitespace: true, syntax: true },
    target: 'bun',
  });

  if (!buildResult.success) {
    console.error(`❌ Build failed for ${platform}:`, JSON.stringify(buildResult, null, 2));
    process.exit(FAILURE_EXIT_CODE);
  }
}

console.log('✅ Done');
