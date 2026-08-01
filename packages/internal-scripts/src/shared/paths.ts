import { join } from 'node:path';

// `bun run --filter` runs a script from its own package directory, so nothing
// may resolve a repo path relative to the process cwd.
export const repoRoot = join(import.meta.dir, '../../../..');

export const terraformDir = join(repoRoot, 'infra/terraform');
