import { NFTABLES_FAMILIES, NFTABLES_TABLE } from '#lib/network/firewall.ts';

type JsonObject = { [key: string]: unknown };
type Table = { objects: Map<string, string>; rules: Map<string, string[]> };

function object(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  const fields = object(value);
  return fields === undefined
    ? value
    : Object.fromEntries(
        Object.keys(fields)
          .sort()
          .map((key) => [key, canonical(fields[key])]),
      );
}

function readEntry(entry: unknown) {
  const fields = object(entry);
  const command = object(fields?.add) ?? fields;
  if (command === undefined) {
    return undefined;
  }
  const [kind, body] = Object.entries(command)[0] ?? [];
  const value = object(body);
  if (
    kind === undefined ||
    value === undefined ||
    (kind === 'table' ? value.name : value.table) !== NFTABLES_TABLE
  ) {
    return undefined;
  }
  return { kind, value };
}

function remember({ table, kind, value }: { table: Table; kind: string; value: JsonObject }) {
  if (kind === 'rule') {
    const chain = String(value.chain);
    const rules = table.rules.get(chain) ?? [];
    rules.push(JSON.stringify(canonical(value)));
    table.rules.set(chain, rules);
    return;
  }
  const fields = { ...value };
  if (kind === 'counter') {
    delete fields.packets;
    delete fields.bytes;
  }
  table.objects.set(`${kind}:${value.name}`, JSON.stringify(canonical(fields)));
}

function fingerprint(table: Table | undefined) {
  if (
    table === undefined ||
    ['input', 'forward'].some(
      (name) => !table.objects.has(`chain:${name}`) || !table.rules.get(name)?.length,
    )
  ) {
    return undefined;
  }
  return { objects: [...table.objects].sort(), rules: [...table.rules].sort() };
}

export function parseKernelRuleset(json: string): string | undefined {
  try {
    const entries = object(JSON.parse(json))?.nftables;
    if (!Array.isArray(entries)) {
      return undefined;
    }
    const tables = new Map<string, Table>();
    for (const entry of entries) {
      const item = readEntry(entry);
      if (item === undefined || !NFTABLES_FAMILIES.some((family) => family === item.value.family)) {
        continue;
      }
      const family = String(item.value.family);
      if (item.kind === 'table') {
        tables.set(family, { objects: new Map(), rules: new Map() });
      }
      const table = tables.get(family);
      if (table === undefined) {
        return undefined;
      }
      remember({ table, ...item });
    }
    const result = NFTABLES_FAMILIES.map((family) => fingerprint(tables.get(family)));
    return result.some((table) => table === undefined) ? undefined : JSON.stringify(result);
  } catch {
    return undefined;
  }
}
