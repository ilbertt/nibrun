import { defineCommand } from '@parshjs/core';
import { z } from 'zod';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { createOutput } from '#lib/output.ts';
import { querySqlite, SQLITE_QUERY_OUTPUT } from '#lib/sqlite/query.ts';
import { selectSqliteConnection } from '#lib/sqlite/select.ts';

export const command = defineCommand('apps sqlite query [sql]', {
  description:
    'Run one read-only SQL statement, quoted as a single argument, against a saved connection. The app needs a running deployment. In --json output, integers are decimal strings and blobs are {base64} objects.',
  options: {},
  params: {
    sql: {
      schema: z.string().refine(function nonblank(value) {
        return value.trim().length > 0;
      }, 'Pass a non-empty SQL statement, quoted as one argument.'),
    },
  },
  beforeHandler: function signedIn({ context }) {
    return requireSignedIn(context);
  },
  handler: async function query({ params, parents, context, print, rootOptions }) {
    const { interactive, emit } = createOutput({
      output: SQLITE_QUERY_OUTPUT,
      print,
      json: rootOptions.json,
    });
    const { api } = context;
    const app = await selectApp({ api, name: parents.apps.options.app, interactive });
    const connection = await selectSqliteConnection({
      api,
      appId: app.id,
      connectionId: parents['apps sqlite query'].options.connection,
      interactive,
    });
    emit(await querySqlite({ api, connection, sql: params.sql }));
  },
});
