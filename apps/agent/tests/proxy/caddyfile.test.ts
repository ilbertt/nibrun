import { describe, expect, test } from 'bun:test';
import type { AppHostname, AppId, Hostname, HostPort } from '@repo/protocol';
import { renderAppSites } from '#proxy/caddyfile.ts';
import type { RouteTarget } from '#report/routes.ts';
import { APP_ID, FIRST_HOST_PORT } from '#tests/support/fixtures.ts';

const SECOND_HOST_PORT = (FIRST_HOST_PORT + 1) as HostPort;

function platformHostname(hostname: string): AppHostname {
  return { hostname: hostname as Hostname, kind: 'platform', isDefault: true };
}

function customHostname(hostname: string): AppHostname {
  return { hostname: hostname as Hostname, kind: 'custom', isDefault: false };
}

function route(overrides: Partial<RouteTarget> = {}): RouteTarget {
  return {
    appId: APP_ID,
    hostnames: [platformHostname('a.apps.example.com')],
    hostPort: FIRST_HOST_PORT,
    ...overrides,
  };
}

describe('the rendered config is a projection of what is running', () => {
  test('an app is reached on the loopback port the host forwards into its guest', () => {
    const sites = renderAppSites([route()]);
    expect(sites).toContain('https://a.apps.example.com {');
    expect(sites).toContain('reverse_proxy 127.0.0.1:21000');
  });

  test('every site authenticates the edge, so none can be reached from the origin address', () => {
    const sites = renderAppSites([route(), route({ appId: 'app-b' as AppId })]);
    const blocks = sites.split('{').length - 1;
    expect(sites.split('import origin_tls').length - 1).toBe(blocks);
  });

  test('nothing is routable when nothing is running', () => {
    expect(renderAppSites([])).not.toContain('reverse_proxy');
  });

  test('an app answers on every hostname it has, not only the default one', () => {
    const sites = renderAppSites([
      route({
        hostnames: [platformHostname('a.apps.example.com'), customHostname('brought.example.dev')],
      }),
    ]);
    expect(sites).toContain('https://a.apps.example.com, https://brought.example.dev {');
  });

  test('rendering twice from the same routes is byte-identical, whatever order they arrive in', () => {
    const first = route({ appId: 'app-b' as AppId, hostPort: SECOND_HOST_PORT });
    const second = route({ appId: 'app-a' as AppId });
    expect(renderAppSites([first, second])).toBe(renderAppSites([second, first]));
  });
});

describe('a record the agent cannot use cannot wedge the whole host', () => {
  test('an unusable hostname is dropped rather than written into the config', () => {
    const sites = renderAppSites([
      route({
        hostnames: [
          platformHostname('a.apps.example.com } respond 500 #'),
          platformHostname('b.apps.example.com'),
        ],
      }),
    ]);
    expect(sites).toContain('https://b.apps.example.com {');
    expect(sites).not.toContain('respond 500');
  });

  test('an app left with no usable hostname is left out entirely', () => {
    const sites = renderAppSites([route({ hostnames: [platformHostname('not a hostname')] })]);
    expect(sites).not.toContain('reverse_proxy');
  });
});
