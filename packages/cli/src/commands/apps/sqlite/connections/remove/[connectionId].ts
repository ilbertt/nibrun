import { defineCommand } from '@parshjs/core';
import { z } from 'zod';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { createOutput } from '#lib/output.ts';
import { removeSqliteConnection, SQLITE_CONNECTION_REMOVED_OUTPUT } from '#lib/sqlite/remove.ts';

export const command = defineCommand('apps sqlite connections remove [connectionId]', {
  description: 'Remove a saved SQLite connection by its ID. The database file stays in the volume.',
  options: {},
  params: {
    connectionId: { schema: z.string().min(1) },
  },
  beforeHandler: function signedIn({ context }) {
    return requireSignedIn(context);
  },
  handler: async function remove({ params, parents, context, print, rootOptions }) {
    const { interactive, ui, emit } = createOutput({
      output: SQLITE_CONNECTION_REMOVED_OUTPUT,
      print,
      json: rootOptions.json,
    });
    const { api } = context;
    ui.open('nib apps sqlite connections remove');
    const app = await selectApp({ api, name: parents.apps.options.app, interactive });
    emit(await removeSqliteConnection({ api, appId: app.id, connectionId: params.connectionId }));
  },
});
