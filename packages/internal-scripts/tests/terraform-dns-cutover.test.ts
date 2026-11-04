import { expect, test } from 'bun:test';
import { isImportedNibrunnerDnsCutover } from '#shared/terraform-dns-cutover.ts';

function importedDnsReplacement() {
  return {
    address: 'cloudflare_dns_record.nibrunner["*.example.com"]',
    change: {
      actions: ['delete', 'create'],
      importing: { id: 'zone/record' },
      before: { type: 'A', name: '*.example.com', zone_id: 'zone' },
      after: { type: 'CNAME', name: '*.example.com', zone_id: 'zone', proxied: true },
    },
  };
}

test('permits adopting an address record as a proxied nibrunner CNAME', function permitsDnsCutover() {
  for (const type of ['A', 'AAAA']) {
    const resource = importedDnsReplacement();
    resource.change.before.type = type;
    expect(isImportedNibrunnerDnsCutover(resource)).toBe(true);
  }
});

test('rejects unrelated records, deletion and replacement outside the import cutover', function protectsOtherDnsChanges() {
  const resource = importedDnsReplacement();
  for (const address of [
    'cloudflare_dns_record.control_plane["api.example.com"]',
    'cloudflare_dns_record.nibrunner_other["*.example.com"]',
    'aws_ebs_volume.data',
  ]) {
    expect(isImportedNibrunnerDnsCutover({ ...resource, address })).toBe(false);
  }
  for (const actions of [['delete'], ['create', 'delete']]) {
    expect(
      isImportedNibrunnerDnsCutover({ ...resource, change: { ...resource.change, actions } }),
    ).toBe(false);
  }
  expect(
    isImportedNibrunnerDnsCutover({
      ...resource,
      change: {
        actions: ['delete', 'create'],
        before: resource.change.before,
        after: resource.change.after,
      },
    }),
  ).toBe(false);
});

test('requires an address-to-CNAME transition with the same name and zone behind Cloudflare', function rejectsDifferentDestinations() {
  const resource = importedDnsReplacement();
  for (const before of [
    { ...resource.change.before, type: 'CNAME' },
    { ...resource.change.before, type: 'TXT' },
  ]) {
    expect(
      isImportedNibrunnerDnsCutover({ ...resource, change: { ...resource.change, before } }),
    ).toBe(false);
  }
  for (const after of [
    { ...resource.change.after, type: 'A' },
    { ...resource.change.after, proxied: false },
    { ...resource.change.after, name: 'other.example.com' },
    { ...resource.change.after, zone_id: 'other-zone' },
  ]) {
    expect(
      isImportedNibrunnerDnsCutover({ ...resource, change: { ...resource.change, after } }),
    ).toBe(false);
  }
});
