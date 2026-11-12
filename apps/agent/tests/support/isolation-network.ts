const HTTP_PORT = 18080;
const READY_ATTEMPTS = 50;
const RETRY_MS = 20;
export const GUEST_NAMESPACE = 'isolation-guest';
const UPSTREAM_NAMESPACE = 'isolation-upstream';
const NEIGHBOR_NAMESPACE = 'isolation-neighbor';
const NAMESPACES = [GUEST_NAMESPACE, UPSTREAM_NAMESPACE, NEIGHBOR_NAMESPACE];

export function networkCommand(args: string[]) {
  const result = Bun.spawnSync(args);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
  return result.stdout.toString();
}

function link({
  namespace,
  host,
  ipv4,
  peer4,
  ipv6,
  peer6,
}: {
  namespace: string;
  host: string;
  ipv4: string;
  peer4: string;
  ipv6: string;
  peer6: string;
}) {
  networkCommand(['ip', 'netns', 'add', namespace]);
  networkCommand([
    'ip',
    'link',
    'add',
    host,
    'type',
    'veth',
    'peer',
    'name',
    'peer',
    'netns',
    namespace,
  ]);
  networkCommand(['ip', 'addr', 'add', ipv4, 'dev', host]);
  networkCommand(['ip', '-6', 'addr', 'add', ipv6, 'dev', host, 'nodad']);
  networkCommand(['ip', 'link', 'set', host, 'up']);
  for (const args of [
    ['link', 'set', 'lo', 'up'],
    ['link', 'set', 'peer', 'up'],
    ['addr', 'add', peer4, 'dev', 'peer'],
    ['-6', 'addr', 'add', peer6, 'dev', 'peer', 'nodad'],
    ['route', 'add', 'default', 'via', ipv4.split('/')[0] ?? ''],
    ['-6', 'route', 'add', 'default', 'via', ipv6.split('/')[0] ?? ''],
  ]) {
    networkCommand(['ip', '-n', namespace, ...args]);
  }
}

export function url(address: string) {
  return `http://${address.includes(':') ? `[${address}]` : address}:${HTTP_PORT}/`;
}

export function reaches({ namespace, address }: { namespace: string; address: string }) {
  return (
    Bun.spawnSync([
      'ip',
      'netns',
      'exec',
      namespace,
      'curl',
      '--noproxy',
      '*',
      '-g',
      '-fsS',
      '--max-time',
      '1',
      url(address),
    ]).exitCode === 0
  );
}

async function waitForServer(namespace: string) {
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt++) {
    if (reaches({ namespace, address: '::1' })) {
      return;
    }
    await Bun.sleep(RETRY_MS);
  }
  throw new Error('The isolation fixture listener did not start.');
}

export function createIsolationNetwork() {
  const servers: ReturnType<typeof Bun.spawn>[] = [];
  let hostServer: ReturnType<typeof Bun.serve> | undefined;
  async function close() {
    hostServer?.stop(true);
    for (const server of servers) {
      server.kill();
    }
    await Promise.all(servers.map((server) => server.exited));
    for (const name of NAMESPACES) {
      Bun.spawnSync(['ip', 'netns', 'del', name]);
    }
    for (const name of ['nbr9001', 'nbr9002', 'isolation-wan']) {
      Bun.spawnSync(['ip', 'link', 'del', name]);
    }
  }
  async function start() {
    networkCommand(['sysctl', '-w', 'net.ipv4.ip_forward=1', 'net.ipv6.conf.all.forwarding=1']);
    link({
      namespace: GUEST_NAMESPACE,
      host: 'nbr9001',
      ipv4: '10.201.0.1/30',
      peer4: '10.201.0.2/30',
      ipv6: 'fd01:1::1/64',
      peer6: 'fd01:1::2/64',
    });
    link({
      namespace: NEIGHBOR_NAMESPACE,
      host: 'nbr9002',
      ipv4: '10.201.0.5/30',
      peer4: '10.201.0.6/30',
      ipv6: 'fd01:2::1/64',
      peer6: 'fd01:2::2/64',
    });
    link({
      namespace: UPSTREAM_NAMESPACE,
      host: 'isolation-wan',
      ipv4: '203.0.113.1/24',
      peer4: '203.0.113.2/24',
      ipv6: '2001:db8:2::1/64',
      peer6: '2001:db8:2::2/64',
    });
    hostServer = Bun.serve({
      hostname: '10.201.0.1',
      port: HTTP_PORT,
      fetch: () => new Response('fixture'),
    });
    for (const address of ['169.254.169.254', '10.43.0.134']) {
      networkCommand([
        'ip',
        '-n',
        UPSTREAM_NAMESPACE,
        'addr',
        'add',
        `${address}/32`,
        'dev',
        'peer',
      ]);
      networkCommand(['ip', 'route', 'add', `${address}/32`, 'via', '203.0.113.2']);
    }
    for (const address of ['fd00:ec2::254', '2600:1f18:abcd::2']) {
      networkCommand([
        'ip',
        '-n',
        UPSTREAM_NAMESPACE,
        '-6',
        'addr',
        'add',
        `${address}/128`,
        'dev',
        'peer',
        'nodad',
      ]);
      networkCommand(['ip', '-6', 'route', 'add', `${address}/128`, 'via', '2001:db8:2::2']);
    }
    for (const namespace of [UPSTREAM_NAMESPACE, NEIGHBOR_NAMESPACE]) {
      servers.push(
        Bun.spawn(
          [
            'ip',
            'netns',
            'exec',
            namespace,
            'python3',
            '-m',
            'http.server',
            String(HTTP_PORT),
            '--bind',
            '::',
          ],
          { stdout: 'ignore', stderr: 'ignore' },
        ),
      );
      await waitForServer(namespace);
    }
  }
  return { start, close };
}
