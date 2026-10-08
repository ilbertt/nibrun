import { parse } from '@babel/parser';
import {
  isExportNamedDeclaration,
  isIdentifier,
  isObjectExpression,
  isObjectProperty,
  isStringLiteral,
  isTSSatisfiesExpression,
  isVariableDeclaration,
  type ObjectExpression,
  type ObjectProperty,
} from '@babel/types';
import type { PresetUpdate } from '#updates/releases.ts';

type Edit = { start: number; end: number; text: string };

export function updatePresetSource(options: { source: string; updates: PresetUpdate[] }): string {
  const { source, updates } = options;
  const file = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  const declaration = file.program.body
    .filter((statement) => isExportNamedDeclaration(statement))
    .map((statement) => statement.declaration)
    .filter((statement) => isVariableDeclaration(statement))
    .flatMap((statement) => statement.declarations)
    .find((candidate) => isIdentifier(candidate.id) && candidate.id.name === 'DEPLOY_PRESETS');
  const initializer = declaration?.init;
  const presets = isTSSatisfiesExpression(initializer) ? initializer.expression : initializer;
  if (!isObjectExpression(presets)) {
    throw new Error('DEPLOY_PRESETS must be an object literal');
  }
  const edits: Edit[] = [];
  for (const update of updates) {
    const preset = property({ object: presets, name: update.slug }).value;
    if (!isObjectExpression(preset)) {
      throw new Error(`Expected an object for ${update.slug}`);
    }
    const link = property({ object: preset, name: 'deployLink' }).value;
    if (!isObjectExpression(link)) {
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

function descendingPosition(...[left, right]: [Edit, Edit]): number {
  return right.start - left.start;
}

function property(options: { object: ObjectExpression; name: string }): ObjectProperty {
  const found = options.object.properties.filter(isObjectProperty).find((candidate) => {
    const name = candidate.key;
    return (
      !candidate.computed &&
      ((isIdentifier(name) && name.name === options.name) ||
        (isStringLiteral(name) && name.value === options.name))
    );
  });
  if (!found) {
    throw new Error(`Missing preset property: ${options.name}`);
  }
  return found;
}

function replacement(options: {
  object: ObjectExpression;
  name: string;
  previous: string | undefined;
  next: string | undefined;
}): Edit {
  const value = property(options).value;
  if (
    !isStringLiteral(value) ||
    value.value !== options.previous ||
    options.next === undefined ||
    value.start == null ||
    value.end == null
  ) {
    throw new Error(`Unexpected preset value for ${options.name}`);
  }
  return { start: value.start, end: value.end, text: JSON.stringify(options.next) };
}
