import { stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { Server } from 'bun';
import { z } from 'zod';
import { UsageError } from '#lib/errors.ts';
import { defineOutput } from '#lib/output.ts';

/** What a folder is served on when nothing is hosting this nib. */
export const DEFAULT_PORT = 3000;

const INDEX_FILE = 'index.html';
const NOT_FOUND = 404;
const NOT_FOUND_BODY = 'Not found';

/**
 * Every interface, which is what a host reaches an app on, against the loopback a folder on
 * somebody's own machine is served on. Handing a local folder to the whole network is not
 * something to arrive at by accident, so which of the two is bound follows from whether anything
 * assigned the port — see `addressFor`.
 */
const EVERY_INTERFACE = '0.0.0.0';
const LOOPBACK = '127.0.0.1';

/** The name a browser reaches `EVERY_INTERFACE` by, that address not being one it can dial. */
const LOCALHOST = 'localhost';

/** A terminal's own way of ending a run, and the one a host sends before it replaces the app. */
const STOP_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/**
 * What the host running this nib said about itself, `null` for each thing it said nothing about.
 * Nothing at all is what says this is somebody's own machine rather than nibrun.
 */
export type HostEnvironment = {
  /** The port nibrun assigns and probes, which the app must be the one listening on. */
  httpPort: number | null;
  /** That same number under the name every other host uses, read for the hosts that set only it. */
  port: number | null;
  /** The name the app is actually reached by, which is not the interface it is bound to. */
  hostname: string | null;
};

/** What `Bun.serve` hands back for a server that never upgrades a connection. */
export type FileServer = Server<undefined>;

/** Where the server listens, and where whoever asked for it should look. */
export type Address = {
  hostname: string;
  port: number;
  url: string;
};

/**
 * The address to serve on, from what was typed and what the host said — in that order, because a
 * flag is the only one of the two anybody chose.
 *
 * A host that assigned the port is a host reaching the app across a network, so it is also what
 * decides the interface: nibrun's guest is only answered on `0.0.0.0`, and everywhere nothing was
 * assigned is a folder being served to the person sitting in front of it.
 */
export function addressFor({
  options,
  environment,
}: {
  options: { port?: number | undefined; host?: string | undefined };
  environment: HostEnvironment;
}): Address {
  const assigned = environment.httpPort ?? environment.port;
  const hostname = options.host ?? (assigned === null ? LOOPBACK : EVERY_INTERFACE);
  const port = options.port ?? assigned ?? DEFAULT_PORT;

  return { hostname, port, url: reachedAt({ hostname, port, announced: environment.hostname }) };
}

/**
 * A host that named the app named the address it is reached at, and it is not the one bound here:
 * nibrun's edge terminates TLS in front of a guest listening on plain HTTP, so the port this
 * process knows about is not part of any URL anybody can type.
 */
function reachedAt({
  hostname,
  port,
  announced,
}: {
  hostname: string;
  port: number;
  announced: string | null;
}): string {
  if (announced !== null) {
    return `https://${announced}`;
  }
  return `http://${hostname === EVERY_INTERFACE ? LOCALHOST : hostname}:${port}`;
}

/**
 * The folder as an absolute path, or a refusal naming what was typed. Asked before the port is
 * bound, so a folder nobody can read costs one line rather than a server answering nothing.
 */
export async function servedRoot(directory: string): Promise<string> {
  const root = resolve(directory);
  const stats = await stat(root).catch(() => undefined);

  if (stats === undefined) {
    throw new UsageError(`No such folder: ${directory}`);
  }
  if (!stats.isDirectory()) {
    throw new UsageError(`${directory} is a file, and what is served is a folder of them.`);
  }
  return root;
}

/**
 * Where a request lands under the root, or nothing where it lands outside it.
 *
 * A pathname is whatever a client sent — `../`, an escape spelled `%2e%2e`, a NUL — so what is
 * asked is whether the resolved path is still inside the folder, rather than whether the text it
 * arrived as looked like an escape.
 */
export function requestedPath({
  root,
  pathname,
}: {
  root: string;
  pathname: string;
}): string | null {
  const decoded = decodedPathname(pathname);
  if (decoded === null) {
    return null;
  }

  const target = resolve(root, `.${decoded}`);
  return target === root || target.startsWith(`${root}${sep}`) ? target : null;
}

function decodedPathname(pathname: string): string | null {
  try {
    const decoded = decodeURIComponent(pathname);
    // A NUL truncates the path every syscall below this reads, so the file opened would not be the
    // one the containment check was made against.
    return decoded.includes('\0') ? null : decoded;
  } catch {
    // Percent-encoding no file could have been meant by.
    return null;
  }
}

/**
 * Serve `root` and nothing else. Content types are the files' own — Bun reads one from the
 * extension, which is the whole of what a static server has to say about a body it hands over
 * untouched.
 */
export function serveDirectory({
  root,
  hostname,
  port,
  singlePage,
}: {
  root: string;
  hostname: string;
  port: number;
  singlePage: boolean;
}): FileServer {
  return Bun.serve({
    hostname,
    port,
    fetch: async (request) => {
      const file = await fileAt({ root, pathname: new URL(request.url).pathname, singlePage });
      return file === null
        ? new Response(NOT_FOUND_BODY, { status: NOT_FOUND })
        : new Response(file);
    },
  });
}

async function fileAt({
  root,
  pathname,
  singlePage,
}: {
  root: string;
  pathname: string;
  singlePage: boolean;
}): Promise<Bun.BunFile | null> {
  const target = requestedPath({ root, pathname });
  // A path that resolved outside the folder is not a route of anybody's app, so it is answered as
  // what it is rather than handed the page: the shell is for paths that were asked for honestly.
  if (target === null) {
    return null;
  }

  const asked = Bun.file(target);
  if (await asked.exists()) {
    return asked;
  }
  // A directory is not a file Bun reads, so falling through to its index is also what answers `/`
  // and every path a browser arrives at with a trailing slash.
  const index = Bun.file(join(target, INDEX_FILE));
  if (await index.exists()) {
    return index;
  }

  return singlePage ? await existingFile(join(root, INDEX_FILE)) : null;
}

async function existingFile(path: string): Promise<Bun.BunFile | null> {
  const file = Bun.file(path);
  return (await file.exists()) ? file : null;
}

/**
 * `cli.main()` exits the moment a handler returns, so serving has to be the handler rather than
 * something it leaves behind. Settles once the server has been asked to stop and has finished
 * answering whatever it was in the middle of.
 */
export function untilStopped(server: FileServer): Promise<void> {
  return new Promise((settle) => {
    for (const signal of STOP_SIGNALS) {
      process.once(signal, () => settle(server.stop()));
    }
  });
}

const ServingSchema = z.object({
  directory: z.string(),
  url: z.string(),
  hostname: z.string(),
  port: z.number(),
  singlePage: z.boolean(),
});

/**
 * The address bound as well as the URL to visit, because on a host those are two different
 * answers and a folder nobody can reach is usually the first of them. Whether the shell is
 * answering for everything is said out loud for the same reason: it is what a 404 that came back
 * 200 turns out to have been.
 */
export const SERVING_OUTPUT = defineOutput({
  schema: ServingSchema,
  render: ({ value, out }) =>
    out.success(
      `${value.url} — serving ${value.directory}${value.singlePage ? ' as a single-page app' : ''}`,
    ),
});
