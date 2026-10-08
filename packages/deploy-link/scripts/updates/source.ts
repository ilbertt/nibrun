import { resolve } from 'node:path';
import * as ts from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/async';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import type { PresetUpdate } from '#scripts/updates/releases.ts';

type Edit = { start: number; end: number; text: string };

export async function updatePresetSource(options: {
  source: string;
  updates: PresetUpdate[];
}): Promise<string> {
  const { source, updates } = options;
  const file = await parseSource(source);
  const declaration = file.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find(
      (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === 'DEPLOY_PRESETS',
    );
  const initializer = declaration?.initializer;
  const presets =
    initializer && ts.isSatisfiesExpression(initializer) ? initializer.expression : initializer;
  if (!presets || !ts.isObjectLiteralExpression(presets)) {
    throw new Error('DEPLOY_PRESETS must be an object literal');
  }
  const edits: Edit[] = [];
  for (const update of updates) {
    const preset = property({ object: presets, name: update.slug }).initializer;
    if (!ts.isObjectLiteralExpression(preset)) {
      throw new Error(`Expected an object for ${update.slug}`);
    }
    const link = property({ object: preset, name: 'deployLink' }).initializer;
    if (!ts.isObjectLiteralExpression(link)) {
      throw new Error(`Expected a deploy link for ${update.slug}`);
    }
    edits.push(
      replacement({
        object: preset,
        name: 'version',
        previous: update.previous.version,
        next: update.next.version,
      }),
      replacement({
        object: link,
        name: 'binary',
        previous: update.previous.binary,
        next: update.next.binary,
      }),
      replacement({
        object: link,
        name: 'sha256',
        previous: update.previous.sha256,
        next: update.next.sha256,
      }),
    );
  }
  edits.sort(descendingPosition);
  let written = source;
  for (const edit of edits) {
    written = written.slice(0, edit.start) + edit.text + written.slice(edit.end);
  }
  return written;
}

async function parseSource(source: string): Promise<ts.SourceFile> {
  const directory = resolve('deploy-preset-source');
  const sourcePath = resolve(directory, 'presets.ts');
  const configPath = resolve(directory, 'tsconfig.json');
  const api = new API({
    cwd: directory,
    fs: createVirtualFileSystem({
      [sourcePath]: source,
      [configPath]: JSON.stringify({
        files: [sourcePath],
        compilerOptions: { noLib: true, noResolve: true },
      }),
    }),
  });
  try {
    const snapshot = await api.updateSnapshot({ openProjects: [configPath] });
    const file = await snapshot.getProject(configPath)?.program.getSourceFile(sourcePath);
    if (!file) {
      throw new Error('Could not parse deploy preset source');
    }
    return file;
  } finally {
    await api.close();
  }
}

function descendingPosition(...[left, right]: [Edit, Edit]): number {
  return right.start - left.start;
}

function property(options: {
  object: ts.ObjectLiteralExpression;
  name: string;
}): ts.PropertyAssignment {
  const found = options.object.properties.filter(ts.isPropertyAssignment).find((candidate) => {
    const name = candidate.name;
    return (ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === options.name;
  });
  if (!found) {
    throw new Error(`Missing preset property: ${options.name}`);
  }
  return found;
}

function replacement(options: {
  object: ts.ObjectLiteralExpression;
  name: string;
  previous: string | undefined;
  next: string | undefined;
}): Edit {
  const value = property(options).initializer;
  if (!ts.isStringLiteral(value) || value.text !== options.previous || options.next === undefined) {
    throw new Error(`Unexpected preset value for ${options.name}`);
  }
  return { start: value.getStart(), end: value.getEnd(), text: JSON.stringify(options.next) };
}
