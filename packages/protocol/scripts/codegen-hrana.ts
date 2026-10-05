import { TypeScriptToTypeBox } from '@sinclair/typebox-codegen';

const UPSTREAM_REVISION = 'd6c75af6353bb1c34985399608e37cd272a35aa1';
const SPECIFICATIONS = ['HRANA_1_SPEC.md', 'HRANA_2_SPEC.md', 'HTTP_V2_SPEC.md'];
const ROOT_TYPES = ['PipelineReqBody', 'PipelineRespBody'];
const sourceFile = new URL('../vendor/hrana-v2/types.ts', import.meta.url);
const outputFile = new URL('../src/domain/hrana-v2.gen.ts', import.meta.url);

if (Bun.argv.includes('--refresh')) {
  await Bun.write(sourceFile, await upstreamDeclarations());
}
const source = await Bun.file(sourceFile).text();
const names = [...source.matchAll(/^type (\w+) =/gm)].map(function name(match) {
  return match[1]!;
});
const identifiers = new RegExp(`\\b(${names.join('|')})\\b`, 'g');
const normalized = source
  .replace(identifiers, function qualify(name) {
    return `Hrana${name[0]!.toUpperCase()}${name.slice(1)}Schema`;
  })
  .replace(/\bundefined\b/g, 'null');
const generated = TypeScriptToTypeBox.Generate(normalized, {
  useExportEverything: true,
  useIdentifiers: true,
})
  .replace(/export type (Hrana\w+)Schema =/g, 'export type $1 =')
  .replace('Type, Static', 'Type, type Static');
const header =
  '// Generated from the pinned MIT-licensed Hrana v2 declarations. Run bun codegen:hrana.\n';
const formatter = Bun.spawn(
  [
    'bun',
    'run',
    '--bun',
    'biome',
    'format',
    '--stdin-file-path',
    outputFile.pathname.replace('.gen.ts', '.ts'),
  ],
  {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
  },
);
formatter.stdin.write(header + generated);
formatter.stdin.end();
const formatted = await new Response(formatter.stdout).text();
if ((await formatter.exited) !== 0) {
  throw new Error('Cannot format generated Hrana schemas');
}
if (Bun.argv.includes('--check')) {
  if ((await Bun.file(outputFile).text()) !== formatted) {
    throw new Error('Hrana schemas are stale; run bun codegen:hrana');
  }
} else {
  await Bun.write(outputFile, formatted);
}

async function upstreamDeclarations(): Promise<string> {
  const declarations = new Map<string, string>();
  for (const specification of SPECIFICATIONS) {
    const url = `https://raw.githubusercontent.com/tursodatabase/libsql/${UPSTREAM_REVISION}/docs/${specification}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Cannot read ${specification}: HTTP ${response.status}`);
    }
    const text = await response.text();
    collectDeclarations({ text, declarations });
    if (specification === 'HTTP_V2_SPEC.md') {
      collectEnvelopes({ text, declarations });
    }
  }
  const ordered: string[] = [];
  const visited = new Set<string>();
  function visit(name: string): void {
    if (visited.has(name)) {
      return;
    }
    visited.add(name);
    const declaration = declarations.get(name);
    if (!declaration) {
      throw new Error(`Missing upstream declaration: ${name}`);
    }
    for (const token of declaration.matchAll(/\b\w+\b/g)) {
      if (declarations.has(token[0])) {
        visit(token[0]);
      }
    }
    ordered.push(declaration);
  }
  for (const name of ROOT_TYPES) {
    visit(name);
  }
  return `type int32 = number;\n\n${ordered.join('\n\n')}\n`;
}

function collectDeclarations({
  text,
  declarations,
}: {
  text: string;
  declarations: Map<string, string>;
}): void {
  for (const block of text.matchAll(/```typescript\n([\s\S]*?)```/g)) {
    for (const match of block[1]!.matchAll(/^type (\w+) =([\s\S]*?)(?=^type |(?![\s\S]))/gm)) {
      if (!match[0].includes('...')) {
        declarations.set(match[1]!, match[0].trim());
      }
    }
  }
}

function collectEnvelopes({
  text,
  declarations,
}: {
  text: string;
  declarations: Map<string, string>;
}): void {
  const request = text.match(/-> (\{[\s\S]*?^})/m)?.[1];
  const response = text.match(/<- (\{[\s\S]*?^})/m)?.[1];
  if (!request || !response) {
    throw new Error('HTTP v2 pipeline envelopes are missing from the pinned specification');
  }
  declarations.set('PipelineReqBody', `type PipelineReqBody = ${request}`);
  declarations.set('PipelineRespBody', `type PipelineRespBody = ${response}`);
}
