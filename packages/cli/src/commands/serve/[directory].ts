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

/** Getters, so the environment is not read until a handler asks. */
const GUEST_ENV: GuestEnvironment = createEnvContext({
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

export const command = defineCommand('serve [directory]', {
  // Not one of the things an owner picks between, being the argument a deployed binary is given.
  // Still readable, as `nib serve anything --help` — the help does not read the positional.
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
  handler: async ({ params, options, print, rootOptions }) => {
    // First, so that a nib outside a guest says so rather than reading a folder it cannot serve.
    const { hostname, port, url } = guestAddress(GUEST_ENV);
    const { emit } = createOutput({ output: SERVING_OUTPUT, print, json: rootOptions.json });
    const singlePage = options['single-page'] ?? false;

    const directory = await servedRoot(params.directory);
    const server = serveDirectory({ root: directory, hostname, port, singlePage });

    emit({ directory, url, port, singlePage });
    await untilStopped(server);
  },
});
