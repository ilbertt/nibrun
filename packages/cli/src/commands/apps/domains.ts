import { defineCommand } from '@parshjs/core';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { APP_DOMAINS_OUTPUT, listDomains } from '#lib/domains.ts';
import { createOutput } from '#lib/output.ts';

export const command = defineCommand('apps domains', {
  description:
    "List the hostnames an app answers on: the one nibrun issued it, and any domain you brought. A brought domain is 'pending' until your DNS points at us.",
  options: {},
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ parents, context, print, rootOptions }) => {
    const { interactive, emit } = createOutput({
      output: APP_DOMAINS_OUTPUT,
      print,
      json: rootOptions.json,
    });
    const { api } = context;
    const slug = await selectApp({ api, slug: parents.apps.options.app, interactive });

    emit(await listDomains({ api, slug }));
  },
});
