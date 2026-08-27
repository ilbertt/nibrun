import { describe, expect, test } from 'bun:test';
import { INSTANCE_STATES } from '@repo/protocol';
import { renderAppSites } from '#lib/proxy/caddyfile.ts';
import { renderableRoutes } from '#lib/report/routes.ts';
import { APP_HOSTNAME, instanceRecord } from '#tests/support/fixtures.ts';

/** Everything a record can say other than that the tenant has answered. */
const DOWN_STATES = INSTANCE_STATES.filter((state) => state !== 'running');

describe('a host answers for the apps it holds, not the ones that happen to be up', () => {
  test.each(DOWN_STATES)('a %s app is still routed here', (state) => {
    expect(renderableRoutes([instanceRecord({ state })])).toHaveLength(1);
  });

  test('an app with no hostname has nothing to answer on', () => {
    expect(renderableRoutes([instanceRecord({ hostnames: [] })])).toEqual([]);
  });

  test('an app is reached on the same port whether or not its microVM is up', () => {
    const [running] = renderableRoutes([instanceRecord()]);
    const [stopped] = renderableRoutes([instanceRecord({ state: 'stopped' })]);

    expect(running?.hostPort).toBe(stopped?.hostPort);
  });
});

describe('stopping an app moves nothing the proxy would have to reload for', () => {
  test('the rendered config is byte-identical whether the app is up or down', () => {
    const up = renderAppSites(renderableRoutes([instanceRecord()]));
    const down = renderAppSites(renderableRoutes([instanceRecord({ state: 'stopped' })]));

    expect(up).toBe(down);
    expect(up).toContain(`https://${APP_HOSTNAME.hostname} {`);
  });
});
