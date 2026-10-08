import { cpSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export function copyMonacoAssets({ destination }: { destination: string }): void {
  const require = createRequire(import.meta.url);
  const monacoRoot = dirname(require.resolve('monaco-editor/package.json'));
  cpSync(join(monacoRoot, 'min/vs'), destination, { recursive: true });
}
