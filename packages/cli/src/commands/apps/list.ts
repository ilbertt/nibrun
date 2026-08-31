import { defineCommand } from '@parshjs/core';
import { APP_LIST_OUTPUT, listApps } from '#lib/app-list.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { createOutput } from '#lib/output.ts';

/**
 * The one command under `apps` that names no app, so `--app` is the one thing forwarded here that
 * it has nothing to do with: this is where an owner who cannot remember a slug goes to read one,
 * and answering it with the question every sibling asks would be circular.
 */
export const command = defineCommand('apps list', {
  description:
    'List your apps: what each is called, what state it is in, and when it last changed.',
  options: {},
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ context, print, rootOptions }) => {
    const { emit } = createOutput({ output: APP_LIST_OUTPUT, print, json: rootOptions.json });

    emit(await listApps({ api: context.api }));
  },
});
