import { defineCommand } from '@parshjs/core';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { createOutput } from '#lib/output.ts';
import { listSqliteConnections, SQLITE_CONNECTIONS_OUTPUT } from '#lib/sqlite/connections.ts';

export const command = defineCommand('apps sqlite connections list', {
  description: 'List an app’s saved SQLite connections, including their IDs, file paths and URLs.',
  options: {},
  beforeHandler: function signedIn({ context }) {
    return requireSignedIn(context);
  },
  handler: async function list({ parents, context, print, rootOptions }) {
    const { interactive, emit } = createOutput({
      output: SQLITE_CONNECTIONS_OUTPUT,
      print,
      json: rootOptions.json,
    });
    const { api } = context;
    const app = await selectApp({ api, name: parents.apps.options.app, interactive });
    emit(await listSqliteConnections({ api, appId: app.id }));
  },
});
