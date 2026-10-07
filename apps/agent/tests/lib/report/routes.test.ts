import { describe, expect, test } from 'bun:test';
import { INSTANCE_STATES } from '@repo/protocol';
import { renderAppSites } from '#lib/proxy/caddyfile.ts';
import { waitingPort } from '#lib/proxy/listener.ts';
import { renderableRoutes } from '#lib/report/routes.ts';
import { APP_HOSTNAME, APP_ID, FIRST_HOST_PORT, instanceRecord } from '#tests/support/fixtures.ts';

const DOWN_STATES = INSTANCE_STATES.filter((state) => state !== 'running');

function routesFor(state: (typeof INSTANCE_STATES)[number]) {
  return renderableRoutes({ records: [instanceRecord({ state })], replacing: new Map() });
}

describe('a host answers for every app it holds', () => {
  test.each(DOWN_STATES)('a %s app is still routed here', (state) => {
    expect(routesFor(state)).toHaveLength(1);
  });

  test('an app with no hostname has nothing to answer on', () => {
    expect(
      renderableRoutes({
        records: [instanceRecord({ hostnames: [] })],
        replacing: new Map(),
      }),
    ).toEqual([]);
  });

  test.each(['pending', 'starting'] as const)(
    '%s traffic goes to the waiting listener',
    (state) => {
      expect(routesFor(state)[0]?.hostPort).toBe(waitingPort(FIRST_HOST_PORT));
    },
  );

  test('a healthy app uses its forwarded port', () => {
    expect(routesFor('running')[0]?.hostPort).toBe(FIRST_HOST_PORT);
    expect(renderAppSites(routesFor('running'))).not.toContain('keepalive off');
  });

  test('replacement keeps its waiting route through the gap between records', () => {
    const record = instanceRecord();
    const replacing = new Map([[APP_ID, record]]);
    const before = renderableRoutes({ records: [record], replacing });
    const between = renderableRoutes({ records: [], replacing });
    const starting = renderableRoutes({ records: [{ ...record, state: 'starting' }], replacing });
    expect(before).toEqual(between);
    expect(starting).toEqual(before);
    expect(before[0]?.hostPort).toBe(waitingPort(FIRST_HOST_PORT));
    expect(renderAppSites(between)).toContain(`https://${APP_HOSTNAME.hostname} {`);
  });

  test('a stopped app keeps its original route for on-request activation', () => {
    expect(renderAppSites(routesFor('running'))).toBe(renderAppSites(routesFor('stopped')));
  });
});
