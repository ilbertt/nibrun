import { defineCommand } from '@parshjs/core';
import { createEnvContext } from '@parshjs/env';
import { RUNTIME_VALUES } from '@repo/protocol';
import { z } from 'zod';
import { createOutput } from '#lib/output.ts';
import {
  type GuestEnvironment,
  guestAddress,
  SERVING_OUTPUT,
  serveDirectory,
  servedRoot,
  untilStopped,
} from '#lib/serve.ts';

/**
 * What the guest tells this app about itself, declared where the one command that reads it is
 * rather than in the context every command is handed. Its properties are getters, so nothing is
 * read from the environment until `guestAddress` asks.
 */
const GUEST: GuestEnvironment = createEnvContext({
  vars: {
    httpPort: {
      name: RUNTIME_VALUES.HTTP_PORT.name,
      schema: z.number().int().positive().nullable(),
      default: null,
    },
    hostname: {
      name: RUNTIME_VALUES.HOSTNAME.name,
      schema: z.string().min(1).nullable(),
      default: null,
    },
  },
});

/**
 * The one command that is the thing being hosted rather than the thing that hosts it, and so the
 * one that takes nothing from the cli context: what it reads instead is what the guest handed the
 * process. Off a guest there is nothing to read and nothing it could serve, so it says so.
 */
export const command = defineCommand('serve [directory]', {
  // Nothing an owner types at their own terminal, so it is not offered among the things they
  // might: it is the argument a deployed binary is given. Still readable where somebody goes
  // looking, as `nib serve anything --help` — the help does not read the positional.
  hidden: true,
  description:
    'Serve a folder of static assets from inside a nibrun app, which is what a folder of them is deployed as: `nib run "./nib serve data"` serves the app volume, on the port and the address the guest hands it. It runs nowhere else — nothing outside a guest assigns the port nibrun probes, and it says so rather than picking one. A path naming a directory is answered with the index.html in it, and a path naming nothing with the folder’s own 404.html where it has one.',
  params: {
    directory: { schema: z.string().min(1) },
  },
  options: {
    'single-page': {
      schema: z.boolean().optional(),
      description:
        'Answer everything no file of its own answers with the index.html at the root, for an app whose routes exist only in the browser. Off by default: it makes every miss a 200, so a stale asset url answers with the page rather than saying it is gone.',
    },
  },
  // Where `requireSignedIn` sits on the commands that talk to the api: the one thing that has to
  // hold before anything else is tried, so that a nib outside a guest says so before it goes
  // reading a folder it has nowhere to serve. Asked again below for the answer rather than the
  // refusal — the environment is read once and cached, so the second ask costs nothing.
  beforeHandler: () => {
    guestAddress(GUEST);
  },
  handler: async ({ params, options, print, rootOptions }) => {
    const { emit } = createOutput({ output: SERVING_OUTPUT, print, json: rootOptions.json });
    const singlePage = options['single-page'] ?? false;
    const { hostname, port, url } = guestAddress(GUEST);

    const directory = await servedRoot(params.directory);
    const server = serveDirectory({ root: directory, hostname, port, singlePage });

    emit({ directory, url, port, singlePage });
    await untilStopped(server);
  },
});
