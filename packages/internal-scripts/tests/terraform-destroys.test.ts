import { expect, test } from 'bun:test';
import { terraformDestroys } from '#shared/terraform-destroys.ts';

test('permits retiring nibrunner TLS while protecting the legacy fleet and persisted data', function permitsOnlyRetiredTls() {
  const result = terraformDestroys({
    resourceChanges: [
      'aws_ssm_parameter.nibrunner_origin_tls_cert',
      'aws_ssm_parameter.nibrunner_origin_tls_key',
      'cloudflare_origin_ca_certificate.nibrunner',
      'tls_cert_request.nibrunner',
      'tls_private_key.nibrunner',
      'aws_ebs_volume.data',
      'cloudflare_origin_ca_certificate.origin["app_host"]',
      'aws_ssm_parameter.cloudflared_token',
    ].map((address) => ({ address, change: { actions: ['delete'] } })),
    allowedAddresses: new Set(),
  });
  expect(result.unexpected).toEqual([
    'aws_ebs_volume.data',
    'aws_ssm_parameter.cloudflared_token',
    'cloudflare_origin_ca_certificate.origin["app_host"]',
  ]);
});

test('does not let a retirement exemption permit replacement or wildcard matches', function rejectsUnexpectedReplacements() {
  const result = terraformDestroys({
    resourceChanges: [
      {
        address: 'cloudflare_origin_ca_certificate.nibrunner',
        change: { actions: ['delete', 'create'] },
      },
      {
        address: 'tls_private_key.nibrunner',
        change: { actions: ['create', 'delete'] },
      },
      {
        address: 'aws_ssm_parameter.nibrunner_cloudflared_token',
        change: { actions: ['delete'] },
      },
      {
        address: 'cloudflare_dns_record.nibrunner["*.example.com"]',
        change: { actions: ['delete', 'create'] },
      },
    ],
    allowedAddresses: new Set(),
  });
  expect(result.unexpected).toEqual(result.destroyed);
});

test('preserves explicit approvals and ignores changes without deletion', function preservesExplicitApprovals() {
  const address = 'aws_instance.nibrunner_host';
  const result = terraformDestroys({
    resourceChanges: [
      { address, change: { actions: ['delete', 'create'] } },
      { address: 'aws_ssm_parameter.nibrunner_cloudflared_token', change: { actions: ['update'] } },
      { address: 'aws_ebs_volume.data', change: { actions: ['no-op'] } },
    ],
    allowedAddresses: new Set([address]),
  });
  expect(result.destroyed).toEqual([address]);
  expect(result.unexpected).toEqual([]);
});
