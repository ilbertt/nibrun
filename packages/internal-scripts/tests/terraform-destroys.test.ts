import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const helperUrl = new URL('../src/shared/terraform.ts', import.meta.url).href;
let fixtureRoot: string;

beforeEach(function createTerraformFixture() {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'terraform-destroys-'));
  mkdirSync(join(fixtureRoot, 'bin'));
  writeFileSync(join(fixtureRoot, 'summary.md'), '');
  writeFileSync(
    join(fixtureRoot, 'bin/terraform'),
    '#!/bin/sh\nprintf "%s" "$TEST_TERRAFORM_PLAN"\n',
    { mode: 0o755 },
  );
});

afterEach(function removeTerraformFixture() {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function checkPlan({
  address,
  actions,
  allowedAddress,
}: {
  address: string;
  actions: string[];
  allowedAddress: string | undefined;
}) {
  return Bun.spawnSync(
    [
      process.execPath,
      '--eval',
      `import { failOnUnexpectedDestroys } from ${JSON.stringify(helperUrl)}; await failOnUnexpectedDestroys('test.tfplan');`,
    ],
    {
      env: {
        ...process.env,
        PATH: `${fixtureRoot}/bin:${process.env.PATH}`,
        GITHUB_STEP_SUMMARY: join(fixtureRoot, 'summary.md'),
        ALLOWED_TERRAFORM_DESTROY_ADDRESSES: allowedAddress ?? '',
        TEST_TERRAFORM_PLAN: JSON.stringify({
          resource_changes: [{ address, change: { actions } }],
        }),
      },
    },
  );
}

test('allows replacing the stateless port relay in either creation order', function permitsRelayReplacement() {
  for (const actions of [
    ['delete', 'create'],
    ['create', 'delete'],
  ]) {
    expect(
      checkPlan({ address: 'aws_instance.port_relay', actions, allowedAddress: undefined })
        .exitCode,
    ).toBe(0);
  }
});

test('rejects removing the port relay without a replacement', function protectsRelayRemoval() {
  const result = checkPlan({
    address: 'aws_instance.port_relay',
    actions: ['delete'],
    allowedAddress: undefined,
  });
  expect(result.exitCode).toBe(1);
  expect(result.stdout.toString()).toContain('Plan destroys/replaces: aws_instance.port_relay');
});

test('still rejects replacing stateful infrastructure', function protectsStatefulResources() {
  for (const address of ['aws_instance.app', 'aws_ebs_volume.data', 'aws_s3_bucket.artifacts']) {
    const result = checkPlan({ address, actions: ['delete', 'create'], allowedAddress: undefined });
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toContain(`Plan destroys/replaces: ${address}`);
  }
});

test('preserves explicit destruction approvals for other resources', function respectsExplicitApprovals() {
  const address = 'aws_instance.app';
  expect(
    checkPlan({ address, actions: ['delete', 'create'], allowedAddress: address }).exitCode,
  ).toBe(0);
});
