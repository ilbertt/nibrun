import { defineCommand } from '@parshjs/core';
import { z } from 'zod';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { createOutput } from '#lib/output.ts';
import { createSqliteConnection, SQLITE_CONNECTION_CREATED_OUTPUT } from '#lib/sqlite/create.ts';

export const command = defineCommand('apps sqlite connections create [path]', {
  description:
    'Save a connection to an existing SQLite file in the persistent volume. Paths match `apps files ls`; the app needs a running deployment.',
  options: {},
  params: {
    path: { schema: z.string().min(1) },
  },
  beforeHandler: function signedIn({ context }) {
    return requireSignedIn(context);
  },
  handler: async function create({ params, parents, context, print, rootOptions }) {
    const { interactive, ui, emit } = createOutput({
      output: SQLITE_CONNECTION_CREATED_OUTPUT,
      print,
      json: rootOptions.json,
    });
    const { api } = context;
    ui.open('nib apps sqlite connections create');
    const app = await selectApp({ api, name: parents.apps.options.app, interactive });
    emit(await createSqliteConnection({ api, appId: app.id, path: params.path }));
  },
});
