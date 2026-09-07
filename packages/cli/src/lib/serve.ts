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
const NOT_FOUND_PAGE = `${NOT_FOUND}.html`;
const EVERY_INTERFACE = '0.0.0.0';
const STOP_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/** `null` for anything the guest did not set, which is every one of them off a guest. */
export type GuestEnvironment = {
  httpPort: number | null;
  hostname: string | null;
};

export type FileServer = Server<undefined>;

export type Address = {
  hostname: string;
  port: number;
  url: string;
};

/**
 * The address bound is not the one the app answers at: nibrun's edge terminates TLS in front of a
 * guest listening on plain HTTP, so the port this process knows about is no part of any URL
 * anybody can type.
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
 * Containment is decided on the resolved path rather than on the text it arrived as, so no list of
 * spellings has to stay ahead of what a client can send.
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
    // A NUL truncates the path every syscall below reads, so the file opened would not be the one
    // the containment check was made against.
    return decoded.includes('\0') ? null : decoded;
  } catch {
    return null;
  }
}

/** Content types are the files' own, Bun reading one from the extension. */
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
  // Outside the folder is not a route of anybody's app, so it is not given the shell either.
  if (target === null) {
    return null;
  }

  const asked = Bun.file(target);
  if (await asked.exists()) {
    return asked;
  }
  // A directory's own index is skipped rather than missed: `serve`'s `--single` rewrites to the
  // root before it looks inside a directory, so a route naming a real folder is still a route.
  if (singlePage) {
    return await existingFile(join(root, INDEX_FILE));
  }
  return await existingFile(join(target, INDEX_FILE));
}

async function existingFile(path: string): Promise<Bun.BunFile | null> {
  const file = Bun.file(path);
  return (await file.exists()) ? file : null;
}

/** `cli.main()` exits the moment a handler returns, so serving has to be one that has not. */
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

export const SERVING_OUTPUT = defineOutput({
  schema: ServingSchema,
  render: ({ value, out }) =>
    out.success(
      `${value.url} — serving ${value.directory}${value.singlePage ? ' as a single-page app' : ''}`,
    ),
});
