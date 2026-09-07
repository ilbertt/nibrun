import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageError } from '#lib/errors.ts';
import {
  addressFor,
  DEFAULT_PORT,
  type FileServer,
  type HostEnvironment,
  requestedPath,
  serveDirectory,
  servedRoot,
} from '#lib/serve.ts';

const ASSIGNED_PORT = 8080;
const CHOSEN_PORT = 4321;
const ANY_FREE_PORT = 0;
const NOT_FOUND = 404;

const ALONE: HostEnvironment = { httpPort: null, port: null, hostname: null };

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratchDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nib-serve-'));
  dirs.push(dir);
  return dir;
}

function hosted(overrides: Partial<HostEnvironment> = {}): HostEnvironment {
  return { httpPort: ASSIGNED_PORT, port: ASSIGNED_PORT, hostname: null, ...overrides };
}

describe('where a folder is served follows from whether anything is hosting this nib', () => {
  test('nothing assigned means the machine it was typed on, and nowhere else', () => {
    expect(addressFor({ options: {}, environment: ALONE })).toEqual({
      hostname: '127.0.0.1',
      port: DEFAULT_PORT,
      url: `http://127.0.0.1:${DEFAULT_PORT}`,
    });
  });

  test('a host that assigned the port is answered on every interface, which is what it reaches', () => {
    expect(addressFor({ options: {}, environment: hosted() })).toMatchObject({
      hostname: '0.0.0.0',
      port: ASSIGNED_PORT,
    });
  });

  test('a host that sets only PORT is a host all the same', () => {
    expect(
      addressFor({ options: {}, environment: { ...ALONE, port: ASSIGNED_PORT } }),
    ).toMatchObject({ hostname: '0.0.0.0', port: ASSIGNED_PORT });
  });

  // The two carry one number on nibrun, so which is read only shows up where they disagree.
  test('the port nibrun assigns is the one it probes, so it wins over the alias beside it', () => {
    expect(addressFor({ options: {}, environment: hosted({ port: CHOSEN_PORT }) }).port).toBe(
      ASSIGNED_PORT,
    );
  });

  test('a flag is the only one of the three anybody chose, so it wins over both', () => {
    expect(addressFor({ options: { port: CHOSEN_PORT }, environment: hosted() })).toMatchObject({
      hostname: '0.0.0.0',
      port: CHOSEN_PORT,
    });
    expect(addressFor({ options: { host: '::1' }, environment: hosted() }).hostname).toBe('::1');
  });

  test('a host that named the app answers with that name rather than the bound address', () => {
    expect(
      addressFor({ options: {}, environment: hosted({ hostname: 'my-app.nibrun.app' }) }).url,
    ).toBe('https://my-app.nibrun.app');
  });
});

describe('a folder is what is served, and it is checked before a port is bound', () => {
  test('one nobody can read is refused in the words `nib` refuses anything else in', async () => {
    const nowhere = join(tmpdir(), 'nib-serve-nothing-here');

    await expect(servedRoot(nowhere)).rejects.toThrow(UsageError);
    await expect(servedRoot(nowhere)).rejects.toThrow('No such folder');
  });

  test('a file is not a folder of them', async () => {
    const file = join(await scratchDir(), 'index.html');
    await writeFile(file, 'hi');

    await expect(servedRoot(file)).rejects.toThrow('is a file');
  });
});

describe('a request reaches a path under the folder or it reaches nothing', () => {
  const root = '/srv/site';

  test('a path inside it resolves to the file it names', () => {
    expect(requestedPath({ root, pathname: '/assets/app.css' })).toBe('/srv/site/assets/app.css');
  });

  test('the root itself is where a bare slash lands', () => {
    expect(requestedPath({ root, pathname: '/' })).toBe(root);
  });

  test('an escape is refused however it is spelled', () => {
    expect(requestedPath({ root, pathname: '/../etc/passwd' })).toBeNull();
    expect(requestedPath({ root, pathname: '/%2e%2e/%2e%2e/etc/passwd' })).toBeNull();
    expect(requestedPath({ root, pathname: '/a/../../etc/passwd' })).toBeNull();
  });

  // A prefix is not a parent: the folder beside the one being served is still outside it.
  test('a sibling whose name starts with the folder is outside it', () => {
    expect(requestedPath({ root, pathname: '/../site-backup/db' })).toBeNull();
  });

  test('a pathname no file could be meant by is refused rather than guessed at', () => {
    expect(requestedPath({ root, pathname: '/a%00.html' })).toBeNull();
    expect(requestedPath({ root, pathname: '/%zz' })).toBeNull();
  });
});

describe('what the server answers with', () => {
  let server: FileServer;
  let origin: string;

  beforeAll(async () => {
    const root = await scratchDir();
    await writeFile(join(root, 'index.html'), '<h1>home</h1>');
    await writeFile(join(root, 'app.css'), 'body{}');
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'docs', 'index.html'), '<h1>docs</h1>');

    server = serveDirectory({ root, hostname: '127.0.0.1', port: ANY_FREE_PORT });
    origin = server.url.origin;
  });

  afterAll(() => server.stop(true));

  test('a file is handed over under the type its extension gives it', async () => {
    const response = await fetch(`${origin}/app.css`);

    expect(await response.text()).toBe('body{}');
    expect(response.headers.get('content-type')).toContain('text/css');
  });

  test('a directory is answered with the index.html in it', async () => {
    expect(await (await fetch(`${origin}/`)).text()).toBe('<h1>home</h1>');
    expect(await (await fetch(`${origin}/docs`)).text()).toBe('<h1>docs</h1>');
    expect(await (await fetch(`${origin}/docs/`)).text()).toBe('<h1>docs</h1>');
  });

  test('a path that is not there is a 404 rather than a stack trace', async () => {
    expect((await fetch(`${origin}/missing.html`)).status).toBe(NOT_FOUND);
  });

  // Encoded, because a client that normalises `../` away never gets to ask this — and one that
  // does not normalise it is exactly the client this is defended against.
  test('a path out of the folder is answered the same way as one that is simply not there', async () => {
    expect((await fetch(`${origin}/%2e%2e/%2e%2e/etc/passwd`)).status).toBe(NOT_FOUND);
  });
});
