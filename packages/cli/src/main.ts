#!/usr/bin/env bun
import { createCli } from '@parshjs/core';
import { createEnvContext } from '@parshjs/env';
import { z } from 'zod';
import { commandTree } from '#command-tree.gen.ts';
import { CancelledError } from '#lib/errors.ts';

const cli = createCli({
  programName: 'nib',
  programDescription: 'Run a binary on nibrun.',
  tree: commandTree,
  context: {
    env: createEnvContext({
      vars: {
        NIBRUN_API_URL: { schema: z.url(), default: 'http://localhost:3000' },
        NIBRUN_API_KEY: { schema: z.string().min(1) },
      },
    }),
  },
  errors: { CANCELLED: CancelledError },
  // Walking away from a prompt is an ordinary ending, and clack has already written the line
  // saying so — the exit code is all that is left to say.
  onError: ({ code, exit }) => (code === 'CANCELLED' ? exit(1) : undefined),
});

declare module '@parshjs/core' {
  interface Register {
    cli: typeof cli;
  }
}

await cli.main();
