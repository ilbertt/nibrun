#!/usr/bin/env bun
import { createCli } from '@parshjs/core';
import { createEnvContext } from '@parshjs/env';
import { z } from 'zod';
import { commandTree } from '#command-tree.gen.ts';
import { DEFAULT_API_URL, PROGRAM_NAME } from '#config.ts';
import { createApi } from '#lib/api.ts';
import { createCredentialsStore } from '#lib/credentials.ts';
import { CancelledError } from '#lib/errors.ts';

const cli = createCli({
  programName: PROGRAM_NAME,
  programDescription: 'Run a binary on nibrun.',
  tree: commandTree,
  context: async () => {
    const env = createEnvContext({
      vars: { NIBRUN_API_URL: { schema: z.url(), default: DEFAULT_API_URL } },
    });
    const apiUrl = env.NIBRUN_API_URL;
    const files = createCredentialsStore();
    const credentials = await files.credentials.maybeRead();
    const api = createApi({ baseUrl: apiUrl, credentials });

    return { apiUrl, files, credentials, api };
  },
  errors: { CANCELLED: CancelledError },
  onError: ({ code, exit }) => (code === 'CANCELLED' ? exit(1) : undefined),
});

declare module '@parshjs/core' {
  interface Register {
    cli: typeof cli;
  }
}

try {
  await cli.main();
} catch (failure) {
  const message = failure instanceof Error ? failure.message : String(failure);
  process.stderr.write(`${PROGRAM_NAME}: ${message}\n`);
  process.exit(1);
}
