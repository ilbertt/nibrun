import { join } from 'node:path';
import { type Options, runGitCliff } from 'git-cliff';
import { packageJson, WORKSPACE_DEPENDENCY, workspacePackageDirs } from '#shared/package-json.ts';
import { repoRoot } from '#shared/paths.ts';

const CLI_PACKAGE_PATH = 'packages/cli';

export const CLI_TAG_PREFIX = 'cli-v';

export const cliChangelog = join(repoRoot, CLI_PACKAGE_PATH, 'CHANGELOG.md');
export const cliVersion = packageJson.cli.version;

const cliPackageJsonPath = join(repoRoot, CLI_PACKAGE_PATH, 'package.json');
const cliffConfig = join(repoRoot, CLI_PACKAGE_PATH, 'cliff.toml');

/** Everything a caller may ask for. The scope is not theirs to set — it is what makes it a release. */
type CliCliffOptions = Omit<Options, 'config' | 'includePath'>;

export async function runCliCliff(options: CliCliffOptions) {
  await runGitCliff(await scoped(options), { cwd: repoRoot });
}

export async function readCliCliff(options: CliCliffOptions): Promise<string> {
  const { stdout } = await runGitCliff(await scoped(options), {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return String(stdout);
}

export async function writeCliVersion(version: string) {
  const updated = { ...packageJson.cli, version };
  await Bun.write(cliPackageJsonPath, `${JSON.stringify(updated, null, 2)}\n`);
}

async function scoped(options: CliCliffOptions): Promise<Options> {
  return {
    ...options,
    config: cliffConfig,
    // git-cliff repeats `--include-path` once per entry of an array, which is the only spelling
    // that takes more than one path — a brace glob is left unexpanded and silently matches nothing.
    // The published type describes only the single-path form.
    includePath: (await cliReleasePaths()) as unknown as string,
  };
}

/**
 * Which commits a release of the CLI is about: the ones touching the CLI, and the ones touching a
 * workspace package it bundles. Read off its dependencies rather than listed, because a package
 * left out of this is not an error anywhere — it is a change that ships inside the binary with no
 * changelog entry and no version bump, which is the one failure this scoping exists to avoid.
 *
 * A path is a proxy for a subject, so the noise is accepted in the other direction: a commit that
 * touched one of these while meaning to change something else is still counted.
 */
async function cliReleasePaths(): Promise<string[]> {
  const workspaceDirs = await workspacePackageDirs();

  const bundled = Object.entries(packageJson.cli.dependencies)
    .filter(([, specifier]) => specifier === WORKSPACE_DEPENDENCY)
    .map(([name]) => {
      const dir = workspaceDirs.get(name);
      if (!dir) {
        throw new Error(`${name} is a dependency of the CLI but not a workspace package.`);
      }
      return dir;
    });

  return [CLI_PACKAGE_PATH, ...bundled].map((dir) => `${dir}/**`);
}
