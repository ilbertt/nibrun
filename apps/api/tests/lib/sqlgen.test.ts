import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schema } from '#db/queries.gen.ts';

const API_ROOT = join(import.meta.dir, '../..');
const SQLGEN_CLI = fileURLToPath(
  new URL('cli/main.js', import.meta.resolve('@ilbertt/bun-sqlgen')),
);
const SQLGEN_TEST_TIMEOUT_MS = 30_000;

async function generateUnfilteredSchema(directory: string): Promise<string> {
  const config = join(directory, 'sqlgen.config.ts');
  const output = join(directory, 'queries.gen.ts');
  await Bun.write(config, 'export default {};');
  const child = Bun.spawn(
    [
      process.execPath,
      SQLGEN_CLI,
      'generate',
      'src/repositories/*.repository.ts',
      '--migrations',
      'src/db/migrations',
      '--config',
      config,
      '--out',
      output,
    ],
    { cwd: API_ROOT, stdout: 'pipe', stderr: 'pipe' },
  );
  const stderr = await new Response(child.stderr).text();
  expect(await child.exited, stderr).toBe(0);
  return output;
}

test(
  'schema filtering preserves query types and nibrun metadata including auth references',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nibrun-sqlgen-'));
    try {
      const unfilteredPath = await generateUnfilteredSchema(directory);
      const unfiltered = await import(unfilteredPath);
      const applicationRelations = Object.keys(schema);
      expect(Object.keys(unfiltered.schema)).not.toEqual(applicationRelations);
      expect(schema).not.toHaveProperty('user');
      expect(unfiltered.schema).toHaveProperty('user');
      for (const relation of applicationRelations) {
        expect(schema[relation as keyof typeof schema]).toEqual(unfiltered.schema[relation]);
      }
      const filteredSource = await Bun.file(join(API_ROOT, 'src/db/queries.gen.ts')).text();
      const unfilteredSource = await Bun.file(unfilteredPath).text();
      const schemaStart = '/** Columns of `';
      expect(filteredSource.split(schemaStart)[0]).toEqual(unfilteredSource.split(schemaStart)[0]);
      expect(schema.apps._columns.owner_id._foreignKeys.apps_owner_id_fkey._references).toEqual({
        _relationName: 'user',
        _columnName: 'id',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  SQLGEN_TEST_TIMEOUT_MS,
);
