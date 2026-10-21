import { describe, expect, test } from 'bun:test';
import { ConfigProvider, Effect } from 'effect';
import { NBD_CLIENT } from '#lib/volumes/nbd.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { platform, provided } from '#tests/support/run.ts';

const run = provided(platform);

describe('the app volume NBD client setting', () => {
  test.each([
    { value: undefined, expected: NBD_CLIENT },
    { value: '', expected: NBD_CLIENT },
    { value: '  ', expected: NBD_CLIENT },
    {
      value: ' /opt/nibrun/bin/app-nbd-client/nbd-client ',
      expected: '/opt/nibrun/bin/app-nbd-client/nbd-client',
    },
  ])('remains optional and trims configured paths: %j', async ({ value, expected }) => {
    const settings = new Map([
      ['AGENT_CONTROL_PLANE_URL', 'http://control.internal'],
      ['AGENT_LOG_INGEST_URL', 'http://logs.internal'],
      ['AGENT_PORT_RELAY_PUBLIC_IPV4', '203.0.113.1'],
      ['AGENT_ZEROFS_STORAGE_PREFIX', 'filesystems/host-1'],
      ['AGENT_ARTIFACT_BUCKET', 'artifacts'],
      ['AGENT_EXPORT_BUCKET', 'exports'],
      ['AGENT_IMPORT_BUCKET', 'imports'],
      ['AGENT_AWS_REGION', 'test-region'],
      ['AGENT_CONTROL_PLANE_CIDRS_V4', '10.0.0.0/8'],
      ['AGENT_CONTROL_PLANE_CIDRS_V6', 'fd00::/8'],
    ]);
    if (value !== undefined) {
      settings.set('AGENT_APP_VOLUME_NBD_CLIENT', value);
    }
    const config = await run(
      AgentConfig.pipe(
        Effect.provide(AgentConfig.Default),
        Effect.withConfigProvider(ConfigProvider.fromMap(settings)),
      ),
    );
    expect(config.appVolumeNbdClient).toBe(expected);
  });
});
