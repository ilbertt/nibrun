import { describe, expect, test } from 'bun:test';
import { INSTANCE_STATES } from '@repo/protocol';
import { renderAppSites } from '#lib/proxy/caddyfile.ts';
import { waitingPort } from '#lib/proxy/listener.ts';
import { renderableRoutes } from '#lib/report/routes.ts';
import { FIRST_HOST_PORT, instanceRecord } from '#tests/support/fixtures.ts';

const DOWN_STATES = INSTANCE_STATES.filter((state) => state !== 'running');

function routesFor(state: (typeof INSTANCE_STATES)[number]) {
  return renderableRoutes([instanceRecord({ state })]);
}

describe('a host answers for every app it holds', () => {
  test.each(DOWN_STATES)('a %s app is still routed here', (state) => {
    expect(routesFor(state)).toHaveLength(1);
  });

  test('an app with no hostname has nothing to answer on', () => {
    expect(renderableRoutes([instanceRecord({ hostnames: [] })])).toEqual([]);
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

  test('a stopped app keeps its original route for on-request activation', () => {
    expect(renderAppSites(routesFor('running'))).toBe(renderAppSites(routesFor('stopped')));
  });
});
