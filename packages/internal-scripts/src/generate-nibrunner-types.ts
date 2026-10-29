import { join } from 'node:path';
import { $ } from 'bun';
import { compile } from 'json-schema-to-typescript';
import { repoRoot } from '#shared/paths.ts';
import versions from '../../../infra/nibrunner-host/versions.json' with { type: 'json' };

const SCHEMA_TIMEOUT_MS = 30_000;
const SCHEMAS = ['desired', 'reported'] as const;

async function generate(schemaName: (typeof SCHEMAS)[number]) {
  const source = `https://raw.githubusercontent.com/ilbertt/nibrunner/${versions.version}/crates/protocol/schema/${schemaName}.schema.json`;
  const output = join(repoRoot, `apps/agent/src/lib/nibrunner/${schemaName}.gen.ts`);
  const response = await fetch(source, { signal: AbortSignal.timeout(SCHEMA_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Nibrunner schema fetch failed: ${response.status} ${source}`);
  }

  const schema = (await response.json()) as Parameters<typeof compile>[0];
  if (!schema.title) {
    throw new Error(`Nibrunner schema has no root type title: ${source}`);
  }
  const declarations = await compile(schema, schema.title, {
    bannerComment: [
      '/**',
      ` * Generated from ${source}`,
      ' * Run bun run --filter @repo/internal-scripts generate-nibrunner-types; do not edit.',
      ' */',
    ].join('\n'),
    format: false,
    unknownAny: true,
    $refOptions: { resolve: { external: false } },
  });
  const generated =
    await $`bun run --bun biome format --stdin-file-path ${output} < ${Buffer.from(declarations)}`
      .cwd(repoRoot)
      .quiet()
      .text();

  if (process.argv.includes('--check')) {
    if (!(await Bun.file(output).exists()) || (await Bun.file(output).text()) !== generated) {
      throw new Error(
        `${schemaName} nibrunner types are stale. Run bun run --filter @repo/internal-scripts generate-nibrunner-types.`,
      );
    }
  } else {
    await Bun.write(output, generated);
  }
}

await Promise.all(SCHEMAS.map(generate));
