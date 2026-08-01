import { $ } from 'bun';

export function aws(args: string[]) {
  return $`aws ${args}`;
}
