import { defineCommand } from '@parshjs/core';
import { z } from 'zod';
import { SHARED_OPTIONS } from '#config.ts';
import { createOutput } from '#lib/output.ts';
import {
  addressFor,
  DEFAULT_PORT,
  SERVING_OUTPUT,
  serveDirectory,
  servedRoot,
  untilStopped,
} from '#lib/serve.ts';

/**
 * The one command that is the thing being hosted rather than the thing that hosts it: a nib
 * deployed as an app's binary serves its volume, and the same nib serves a folder here. So it
 * talks to no api and needs no token — what it reads instead is what the host handed the process.
 */
export const command = defineCommand('serve [directory]', {
  description:
    'Serve a folder of files over HTTP. On this machine that is http://127.0.0.1:3000; on nibrun it binds the port and the interface the guest hands it, so `nib run "./nib serve data"` deploys the app volume as a static site. A path naming a directory is answered with the index.html in it, and a path naming nothing with the folder’s own 404.html where it has one.',
  params: {
    directory: { schema: z.string().min(1) },
  },
  options: {
    [SHARED_OPTIONS.port.name]: {
      ...SHARED_OPTIONS.port.option,
      description: `Port to listen on. Defaults to the one the host assigned, and to ${DEFAULT_PORT} where nothing did.`,
    },
    host: {
      schema: z.string().optional(),
      description:
        'Interface to listen on. Defaults to 127.0.0.1, and to 0.0.0.0 wherever a host assigned the port — which is the only address nibrun reaches an app on.',
    },
    'single-page': {
      schema: z.boolean().optional(),
      description:
        'Answer everything no file of its own answers with the index.html at the root, for an app whose routes exist only in the browser. Off by default: it makes every miss a 200, so a stale asset url answers with the page rather than saying it is gone.',
    },
  },
  handler: async ({ params, options, context, print, rootOptions }) => {
    const { emit } = createOutput({ output: SERVING_OUTPUT, print, json: rootOptions.json });
    const { 'single-page': singlePage = false, ...listening } = options;

    const directory = await servedRoot(params.directory);
    const address = addressFor({ options: listening, environment: context.runtime });
    const server = serveDirectory({ root: directory, ...address, singlePage });

    emit({ directory, ...address, singlePage });
    await untilStopped(server);
  },
});
