import { expect, test } from 'bun:test';
import { unexpectedTerraformDestroys } from '#shared/terraform.ts';

function deletion(address: string) {
  return { address, change: { actions: ['delete'] } };
}

test('retired dashboard credentials can be deleted without an override', () => {
  expect(
    unexpectedTerraformDestroys({
      changes: [
        deletion('aws_ssm_parameter.dozzle_password'),
        deletion('aws_ssm_parameter.victorialogs_password'),
        deletion('random_password.dozzle_password'),
        deletion('random_password.victorialogs_password'),
      ],
      allowed: new Set(),
    }),
  ).toEqual([]);
});

test('credential cleanup does not allow unrelated parameters or persistent volumes to be deleted', () => {
  expect(
    unexpectedTerraformDestroys({
      changes: [
        deletion('aws_ssm_parameter.dozzle_password'),
        deletion('aws_ebs_volume.data'),
        deletion('aws_ssm_parameter.pgweb_auth_pass'),
      ],
      allowed: new Set(),
    }),
  ).toEqual(['aws_ebs_volume.data', 'aws_ssm_parameter.pgweb_auth_pass']);
});

test('neither replacement order is allowed for retired dashboard parameters', () => {
  expect(
    unexpectedTerraformDestroys({
      changes: [
        {
          address: 'aws_ssm_parameter.dozzle_password',
          change: { actions: ['delete', 'create'] },
        },
        {
          address: 'aws_ssm_parameter.victorialogs_password',
          change: { actions: ['create', 'delete'] },
        },
      ],
      allowed: new Set(),
    }),
  ).toEqual(['aws_ssm_parameter.dozzle_password', 'aws_ssm_parameter.victorialogs_password']);
});

test('explicit allowlists continue to authorize other deletions and replacements', () => {
  expect(
    unexpectedTerraformDestroys({
      changes: [
        deletion('aws_ebs_volume.data'),
        { address: 'aws_instance.app_host', change: { actions: ['delete', 'create'] } },
        deletion('aws_ssm_parameter.pgweb_auth_pass'),
      ],
      allowed: new Set(['aws_ebs_volume.data', 'aws_instance.app_host']),
    }),
  ).toEqual(['aws_ssm_parameter.pgweb_auth_pass']);
});
