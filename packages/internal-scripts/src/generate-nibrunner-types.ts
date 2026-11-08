import { join } from 'node:path';
import { $ } from 'bun';
import { compile } from 'json-schema-to-typescript';
import { nibrunnerTenantLogSchema } from '#shared/nibrunner-schema.ts';
import { repoRoot } from '#shared/paths.ts';
import versions from '../../../infra/nibrunner-host/versions.json' with { type: 'json' };

const SCHEMA_TIMEOUT_MS = 30_000;
const SCHEMAS = {
  desired: 'crates/protocol/schema/desired.schema.json',
  reported: 'crates/protocol/schema/reported.schema.json',
  filesystem: 'crates/nibrunnerd/filesystem.openapi.json',
  'tenant-log': 'crates/protocol/schema/tenant-log.schema.json',
} as const;

function filesystemSchema(value: unknown) {
  const document = value as {
    components: { schemas: Record<string, Parameters<typeof compile>[0]> };
  };
  return JSON.parse(
    JSON.stringify({
      ...document.components.schemas.DirectoryListing,
      title: 'DirectoryListing',
      $defs: document.components.schemas,
    }).replaceAll('#/components/schemas/', '#/$defs/'),
  ) as Parameters<typeof compile>[0];
}

async function generate(schemaName: keyof typeof SCHEMAS) {
  const source = `https://raw.githubusercontent.com/ilbertt/nibrunner/${versions.version}/${SCHEMAS[schemaName]}`;
  const output = join(repoRoot, `apps/agent/src/lib/nibrunner/${schemaName}.gen.ts`);
  const response = await fetch(source, { signal: AbortSignal.timeout(SCHEMA_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Nibrunner schema fetch failed: ${response.status} ${source}`);
  }

  const document = await response.json();
  const schema =
    schemaName === 'filesystem'
      ? filesystemSchema(document)
      : schemaName === 'tenant-log'
        ? nibrunnerTenantLogSchema(document)
        : (document as Parameters<typeof compile>[0]);
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

await Promise.all((Object.keys(SCHEMAS) as (keyof typeof SCHEMAS)[]).map(generate));
