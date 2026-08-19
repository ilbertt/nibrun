import { join } from 'node:path';
import type { Options } from 'git-cliff';
import { repoRoot } from '#shared/paths.ts';

const CLI_PACKAGE_PATH = 'packages/cli';

export const CLI_TAG_PREFIX = 'cli-v';

export const cliPackageJson = join(repoRoot, CLI_PACKAGE_PATH, 'package.json');
export const cliChangelog = join(repoRoot, CLI_PACKAGE_PATH, 'CHANGELOG.md');

/**
 * What every git-cliff invocation for this train shares.
 *
 * `includePath` is what keeps the CLI's history its own: most of this monorepo is not `nib`, so
 * without it every dashboard and infra commit would land in the changelog and move the version.
 * The cost is that a release commit has to touch `packages/cli/` for its tag to survive the
 * filter — bumping the version there is what guarantees it does.
 *
 * `satisfies` rather than a bare object, because git-cliff takes an all-optional bag: a misspelled
 * key is not a type error at any call site, it is an option silently dropped — and dropping this
 * one releases the whole monorepo under the CLI's name.
 */
export const cliCliffOptions = {
  config: join(repoRoot, CLI_PACKAGE_PATH, 'cliff.toml'),
  includePath: `${CLI_PACKAGE_PATH}/**`,
} satisfies Options;

export async function readCliVersion(): Promise<string> {
  const { version } = (await Bun.file(cliPackageJson).json()) as { version: string };
  return version;
}
