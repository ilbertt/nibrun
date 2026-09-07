import { defineCommand } from '@parshjs/core';
import { z } from 'zod';
import { createOutput } from '#lib/output.ts';
import {
  guestAddress,
  SERVING_OUTPUT,
  serveDirectory,
  servedRoot,
  untilStopped,
} from '#lib/serve.ts';

/**
 * The one command that is the thing being hosted rather than the thing that hosts it, and so the
 * one that talks to no api and needs no token: what it reads instead is what the guest handed the
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
  handler: async ({ params, options, context, print, rootOptions }) => {
    const { emit } = createOutput({ output: SERVING_OUTPUT, print, json: rootOptions.json });
    const singlePage = options['single-page'] ?? false;

    // Before the folder is read, because a nib that is not in a guest has nowhere to serve one
    // whether or not the path is good, and that is the more useful of the two things to be told.
    const { hostname, port, url } = guestAddress(context.runtime);
    const directory = await servedRoot(params.directory);
    const server = serveDirectory({ root: directory, hostname, port, singlePage });

    emit({ directory, url, port, singlePage });
    await untilStopped(server);
  },
});
