import { dirname, join } from 'node:path';
import { repoRoot } from '#shared/paths.ts';
import rootPackageJson from '../../../../package.json' with { type: 'json' };
import cliPackageJson from '../../../cli/package.json' with { type: 'json' };

/**
 * The package.json files scripts read, imported rather than opened so each is handed the real
 * shape of its file instead of `any`. One a script comes to need is one more entry here, not
 * another relative path spelled at the point of use.
 */
export const packageJson = {
  root: rootPackageJson,
  cli: cliPackageJson,
};

export const WORKSPACE_DEPENDENCY = 'workspace:*';

/**
 * Every workspace package by name, mapped to its directory relative to the repo root. Built from
 * the packages the root declares rather than assuming a directory is named after what is inside
 * it — the two agree today, and nothing would say so if they stopped.
 */
export async function workspacePackageDirs(): Promise<Map<string, string>> {
  const dirs = new Map<string, string>();

  for (const pattern of packageJson.root.workspaces.packages) {
    for await (const path of new Bun.Glob(`${pattern}/package.json`).scan({ cwd: repoRoot })) {
      const { name }: { name: string } = await Bun.file(join(repoRoot, path)).json();
      dirs.set(name, dirname(path));
    }
  }
  return dirs;
}
