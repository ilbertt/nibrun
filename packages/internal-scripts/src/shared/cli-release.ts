import { join } from 'node:path';
import { $ } from 'bun';
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

/**
 * The version the next release carries, as CalVer `YYYY.M.D-N` with no leading zeros —
 * `2026.8.19-1`. Dates rather than semver because most of what reaches the CLI reaches it as a
 * side effect of work aimed elsewhere, and asking whether that was a feature or a fix has no
 * answer worth the argument.
 *
 * The `-N` is a same-day counter and is on every release, the day's first included. It cannot be
 * dropped for the first: semver ranks a version carrying a pre-release tag *below* the same
 * version without one, so a bare `2026.8.19` would sort above every re-cut that day.
 */
export async function nextCliVersion(): Promise<string> {
  const now = new Date();
  const today = `${now.getUTCFullYear()}.${now.getUTCMonth() + 1}.${now.getUTCDate()}`;

  const tags = (await $`git tag --list`.cwd(repoRoot).text()).split('\n').filter(Boolean);
  const cutToday = tags.filter((tag) => tag.startsWith(`${CLI_TAG_PREFIX}${today}-`)).length;

  return `${today}-${cutToday + 1}`;
}

/**
 * Whether anything in scope has landed since the last release. A date-based version differs from
 * the last one whichever day it is asked on, so unlike a bump it cannot itself say that there is
 * nothing to release.
 */
export async function hasUnreleasedChanges(): Promise<boolean> {
  const context = JSON.parse(await readCliCliff({ unreleased: true, context: true }));
  return context.some(({ commits }: { commits: unknown[] }) => commits.length > 0);
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
