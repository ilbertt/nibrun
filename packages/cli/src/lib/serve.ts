import { stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { RUNTIME_VALUES } from '@repo/protocol';
import type { Server } from 'bun';
import { z } from 'zod';
import { PROGRAM_NAME } from '#config.ts';
import { UsageError } from '#lib/errors.ts';
import { defineOutput } from '#lib/output.ts';

const INDEX_FILE = 'index.html';
const NOT_FOUND = 404;
const NOT_FOUND_BODY = 'Not found';

/**
 * The page a folder answers its own misses with, named after the status it is answering — which is
 * the convention `serve` and every static host reads, and the reason it is spelled from the code
 * rather than written out.
 */
const NOT_FOUND_PAGE = `${NOT_FOUND}.html`;

/** The one address nibrun reaches an app on, and so the only one worth binding. */
const EVERY_INTERFACE = '0.0.0.0';

/** A terminal's own way of ending a run, and the one a host sends before it replaces the app. */
const STOP_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/**
 * What the guest tells an app about itself. Both are set on every instance, so `null` here is not
 * a guest that left something out — it is a nib running somewhere that is not a guest at all.
 */
export type GuestEnvironment = {
  /** The port nibrun assigns and probes, which the app must be the one listening on. */
  httpPort: number | null;
  /** The name the app is reached by, which is not the interface it is bound to. */
  hostname: string | null;
};

/** What `Bun.serve` hands back for a server that never upgrades a connection. */
export type FileServer = Server<undefined>;

/** Where the server listens, and where whoever deployed it should look. */
export type Address = {
  hostname: string;
  port: number;
  url: string;
};

/**
 * Where to listen, and the address the app answers at — which is not the one bound: nibrun's edge
 * terminates TLS in front of a guest listening on plain HTTP, so the port this process knows about
 * is no part of any URL anybody can type.
 *
 * Refused rather than defaulted where the guest said nothing, because there is no answer to default
 * to. A port nobody assigned is a port nothing probes, and a folder served on one is a folder
 * nothing ever reaches.
 */
export function guestAddress(environment: GuestEnvironment): Address {
  const { httpPort, hostname } = environment;

  if (httpPort === null) {
    throw offNibrun(RUNTIME_VALUES.HTTP_PORT.name);
  }
  if (hostname === null) {
    throw offNibrun(RUNTIME_VALUES.HOSTNAME.name);
  }
  return { hostname: EVERY_INTERFACE, port: httpPort, url: `https://${hostname}` };
}

function offNibrun(variable: string): UsageError {
  return new UsageError(
    `${PROGRAM_NAME} serve is the binary a folder of assets is deployed as, and it serves on what the guest tells it. Nothing set ${variable} here, so this is not one. Deploy the folder instead: ${PROGRAM_NAME} run "./${PROGRAM_NAME} serve data"`,
  );
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
      return file === null ? await missing(root) : new Response(file);
    },
  });
}

/**
 * The folder's own `404.html` where it has one, and a bare line where it does not.
 *
 * Answered as the 404 it is rather than as a 200: a browser, a crawler and a `curl -f` all read
 * the status rather than the page, and a "not found" served under a 200 is the one answer none of
 * them can act on.
 */
async function missing(root: string): Promise<Response> {
  const page = await existingFile(join(root, NOT_FOUND_PAGE));
  return page === null
    ? new Response(NOT_FOUND_BODY, { status: NOT_FOUND })
    : new Response(page, { status: NOT_FOUND });
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
  // Everything a real file did not answer is the app's own routing to do, directory indexes
  // included: `serve`'s `--single` rewrites every path to the root index.html *before* it looks
  // for one in the directory that was asked for, so a route that happens to name a real folder is
  // still a route rather than somewhere to go looking.
  if (singlePage) {
    return await existingFile(join(root, INDEX_FILE));
  }

  // A directory is not a file Bun reads, so falling through to its index is also what answers `/`
  // and every path a browser arrives at with a trailing slash.
  return await existingFile(join(target, INDEX_FILE));
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
  port: z.number(),
  singlePage: z.boolean(),
});

/**
 * The port as well as the URL, those being two different answers here and the port the one an app
 * that came up serving nothing turns out to have got wrong. Whether the shell is answering for
 * everything is said out loud for the same reason: it is what a 404 that came back 200 was.
 */
export const SERVING_OUTPUT = defineOutput({
  schema: ServingSchema,
  render: ({ value, out }) =>
    out.success(
      `${value.url} — serving ${value.directory}${value.singlePage ? ' as a single-page app' : ''}`,
    ),
});
