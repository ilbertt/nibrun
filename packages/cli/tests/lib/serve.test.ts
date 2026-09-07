import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageError } from '#lib/errors.ts';
import {
  type FileServer,
  type GuestEnvironment,
  guestAddress,
  requestedPath,
  serveDirectory,
  servedRoot,
} from '#lib/serve.ts';

const ASSIGNED_PORT = 8080;
const ANY_FREE_PORT = 0;
const OK = 200;
const NOT_FOUND = 404;

const IN_A_GUEST: GuestEnvironment = { httpPort: ASSIGNED_PORT, hostname: 'my-app.nibrun.app' };

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratchDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nib-serve-'));
  dirs.push(dir);
  return dir;
}

describe('a folder is served on what the guest assigned, or it is not served at all', () => {
  // Every interface, because that is the only address nibrun reaches a guest on; and the app's own
  // name, because the port bound here is behind the edge and is in no URL anybody can type.
  test('the port it was given, on every interface, under the name it is reached by', () => {
    expect(guestAddress(IN_A_GUEST)).toEqual({
      hostname: '0.0.0.0',
      port: ASSIGNED_PORT,
      url: 'https://my-app.nibrun.app',
    });
  });

  test('no port from the guest is no guest, and it says which name was missing', () => {
    expect(() => guestAddress({ ...IN_A_GUEST, httpPort: null })).toThrow(UsageError);
    expect(() => guestAddress({ ...IN_A_GUEST, httpPort: null })).toThrow('NIBRUN_HTTP_PORT');
  });

  test('nor is a guest that never said what the app is called', () => {
    expect(() => guestAddress({ ...IN_A_GUEST, hostname: null })).toThrow('NIBRUN_HOSTNAME');
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

/** A file sitting beside the served folder, which no spelling of a path should ever reach. */
const OUTSIDE_FILE = 'secret.txt';

/** A site with a page at the root, one in a directory, and an asset beside them. */
async function siteServedWith({
  singlePage,
  notFoundPage = false,
}: {
  singlePage: boolean;
  notFoundPage?: boolean;
}): Promise<FileServer> {
  const scratch = await scratchDir();
  const root = join(scratch, 'site');

  await mkdir(join(root, 'docs'), { recursive: true });
  await writeFile(join(scratch, OUTSIDE_FILE), 'not yours');
  await writeFile(join(root, 'index.html'), '<h1>home</h1>');
  await writeFile(join(root, 'app.css'), 'body{}');
  await writeFile(join(root, 'docs', 'index.html'), '<h1>docs</h1>');
  if (notFoundPage) {
    await writeFile(join(root, '404.html'), '<h1>nothing here</h1>');
  }

  return serveDirectory({ root, hostname: '127.0.0.1', port: ANY_FREE_PORT, singlePage });
}

describe('what the server answers with', () => {
  let server: FileServer;
  let origin: string;

  beforeAll(async () => {
    server = await siteServedWith({ singlePage: false });
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

  // The default, and the whole reason the fallback below is asked for rather than assumed: a link
  // nobody wrote a page for is a link that is wrong, and saying so is the only way anybody finds out.
  test('a route with no file behind it is a 404 too, until somebody asks for otherwise', async () => {
    expect((await fetch(`${origin}/projects/nibrun`)).status).toBe(NOT_FOUND);
  });

  // No spelling of an escape reaches `requestedPath` over HTTP: the URL parser resolves `..` —
  // and `%2e%2e`, which it reads as that same segment — before a pathname is anything this can
  // look at. So what is pinned here is the end of it, that nothing beside the folder is ever
  // handed over. The check itself is exercised directly, above.
  test('a file next door is never handed over, however the path is spelled', async () => {
    for (const spelling of [
      `/../${OUTSIDE_FILE}`,
      `/%2e%2e/${OUTSIDE_FILE}`,
      `/docs/../../${OUTSIDE_FILE}`,
    ]) {
      expect((await fetch(`${origin}${spelling}`)).status).toBe(NOT_FOUND);
    }
  });
});

describe('a single-page app is routed in the browser, so the shell answers for its routes', () => {
  let server: FileServer;
  let origin: string;

  beforeAll(async () => {
    server = await siteServedWith({ singlePage: true });
    origin = server.url.origin;
  });

  afterAll(() => server.stop(true));

  test('a route with no file behind it is the page, and a page is a 200', async () => {
    const response = await fetch(`${origin}/projects/nibrun`);

    expect(response.status).toBe(OK);
    expect(await response.text()).toBe('<h1>home</h1>');
  });

  test('a file that is there still wins, so assets are not shadowed by the shell', async () => {
    expect(await (await fetch(`${origin}/app.css`)).text()).toBe('body{}');
    expect(await (await fetch(`${origin}/docs/index.html`)).text()).toBe('<h1>docs</h1>');
  });

  // What `serve`'s `--single` does, and the one place it differs from serving the folder plainly:
  // the rewrite to the root index.html is applied before a directory is ever looked inside, so a
  // real folder with a real index.html in it is answered by the shell all the same.
  test('a directory with an index of its own is a route like any other', async () => {
    expect(await (await fetch(`${origin}/docs`)).text()).toBe('<h1>home</h1>');
    expect(await (await fetch(`${origin}/docs/`)).text()).toBe('<h1>home</h1>');
  });

  // The cost of asking for this, pinned down rather than left to be discovered: a stale bundle url
  // answers with the page, and the app reports a syntax error rather than a missing file.
  test('an asset that is gone answers with the page as well, which is what the flag buys', async () => {
    const response = await fetch(`${origin}/assets/app-a1b2c3.js`);

    expect(response.status).toBe(OK);
    expect(await response.text()).toBe('<h1>home</h1>');
  });

  test('a path reaching out of the folder gets the shell rather than what is out there', async () => {
    const response = await fetch(`${origin}/%2e%2e/${OUTSIDE_FILE}`);

    expect(await response.text()).toBe('<h1>home</h1>');
  });

  test('a folder with no index.html to fall back on has nothing to answer with', async () => {
    const root = await scratchDir();
    await writeFile(join(root, 'app.css'), 'body{}');
    const bare = serveDirectory({
      root,
      hostname: '127.0.0.1',
      port: ANY_FREE_PORT,
      singlePage: true,
    });

    expect((await fetch(`${bare.url.origin}/anywhere`)).status).toBe(NOT_FOUND);
    await bare.stop(true);
  });
});

describe("a folder's own 404.html is what its misses are answered with", () => {
  let server: FileServer;
  let origin: string;

  beforeAll(async () => {
    server = await siteServedWith({ singlePage: false, notFoundPage: true });
    origin = server.url.origin;
  });

  afterAll(() => server.stop(true));

  // The status, not just the page: a browser, a crawler and a `curl -f` all read that rather than
  // the body, and `serve` writes the code it was answering rather than a 200 for the same reason.
  test('the page is served, and it is served as the 404 it is', async () => {
    const response = await fetch(`${origin}/missing.html`);

    expect(response.status).toBe(NOT_FOUND);
    expect(await response.text()).toBe('<h1>nothing here</h1>');
    expect(response.headers.get('content-type')).toContain('text/html');
  });

  test('a route with no page behind it reaches it too', async () => {
    expect(await (await fetch(`${origin}/projects/nibrun`)).text()).toBe('<h1>nothing here</h1>');
  });

  test('what the folder does have is still answered with itself', async () => {
    expect(await (await fetch(`${origin}/`)).text()).toBe('<h1>home</h1>');
    expect(await (await fetch(`${origin}/app.css`)).text()).toBe('body{}');
  });
});
