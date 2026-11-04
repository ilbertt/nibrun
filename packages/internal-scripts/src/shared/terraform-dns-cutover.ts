function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isImportedNibrunnerDnsCutover(resource: {
  address: string;
  change: {
    actions: string[];
    importing?: unknown;
    before?: unknown;
    after?: unknown;
  };
}) {
  const { importing, before, after } = resource.change;
  if (!(isRecord(importing) && isRecord(before) && isRecord(after))) {
    return false;
  }
  return (
    resource.address.startsWith('cloudflare_dns_record.nibrunner[') &&
    resource.change.actions.join(',') === 'delete,create' &&
    typeof importing.id === 'string' &&
    importing.id.length > 0 &&
    (before.type === 'A' || before.type === 'AAAA') &&
    after.type === 'CNAME' &&
    after.proxied === true &&
    before.name === after.name &&
    before.zone_id === after.zone_id
  );
}
