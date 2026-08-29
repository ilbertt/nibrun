import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PROGRAM_NAME } from '#config.ts';
import { RELEASE_PLATFORMS } from './release-platforms.ts';

const CLI_DIR = join(import.meta.dir, '..');
const DIST_DIR = join(CLI_DIR, 'dist');
const BUN_VERSION_FILE = join(CLI_DIR, '../../.bun-version');
const ENTRYPOINT = 'src/main.ts';
const CHECKSUMS_FILE = 'checksums.txt';

const FAILURE_EXIT_CODE = 1;

// The target pins the released Bun `.bun-version` names rather than resolving to whichever one
// runs the build. Left unversioned, Bun embeds its own version and downloads it for every platform
// that is not the host — and a canary publishes no such download, so two of these three would fail
// for anyone on one. The versioned form is undocumented, and the type does not describe it.
const bunVersion = (await Bun.file(BUN_VERSION_FILE).text()).trim();

console.log('🧹 Cleaning dist dir...');
await rm(DIST_DIR, { recursive: true, force: true });

const checksums: string[] = [];

for (const platform of RELEASE_PLATFORMS) {
  const binaryName = `${PROGRAM_NAME}-${platform}`;
  const outfile = join(DIST_DIR, binaryName);

  console.log(`🔨 Compiling ${binaryName}...`);
  const buildResult = await Bun.build({
    entrypoints: [ENTRYPOINT],
    compile: {
      outfile,
      target: `bun-v${bunVersion}-${platform}` as unknown as Bun.Build.CompileTarget,
    },
    // Startup is paid on every invocation of an interactive CLI and the size once, at download.
    // `format` is spelled out because `bytecode` defaults it to CommonJS, which has no top-level
    // await — and `main.ts` awaits the command it is about to run.
    bytecode: true,
    format: 'esm',
    minify: { whitespace: true, syntax: true },
    target: 'bun',
  });

  if (!buildResult.success) {
    console.error(`❌ Build failed for ${platform}:`, JSON.stringify(buildResult, null, 2));
    process.exit(FAILURE_EXIT_CODE);
  }

  checksums.push(`${await sha256(outfile)}  ${binaryName}`);
}

console.log(`🧾 Writing ${CHECKSUMS_FILE}...`);
await Bun.write(join(DIST_DIR, CHECKSUMS_FILE), `${checksums.join('\n')}\n`);

console.log('✅ Done');

/**
 * Streamed rather than hashed in one go, because each of these is tens of megabytes and the whole
 * point of the file is that it is produced for every platform on one machine.
 */
async function sha256(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256');
  for await (const chunk of Bun.file(path).stream()) {
    hasher.update(chunk);
  }
  return hasher.digest('hex');
}
