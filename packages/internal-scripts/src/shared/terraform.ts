import { $ } from 'bun';
import { terraformDir } from '#shared/paths.ts';

export function terraform(args: string[]) {
  return $`terraform ${args}`.cwd(terraformDir);
}
