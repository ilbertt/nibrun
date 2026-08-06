#!/usr/bin/env bun
import { createCli } from '@parshjs/core';
import { createEnvContext } from '@parshjs/env';
import type { TenantArguments } from '@repo/protocol';
import { z } from 'zod';
import { commandTree } from '#command-tree.gen.ts';
import { CancelledError } from '#lib/errors.ts';

/**
 * Everything past the first `--` belongs to the deployed binary, not to us. The split happens
 * here because the router reads every positional as a command, so a tenant's `serve --port 8080`
 * would otherwise be read as a `nib` command that does not exist.
 */
const TENANT_ARGS_SEPARATOR = '--';

const argv = process.argv.slice(2);
const separator = argv.indexOf(TENANT_ARGS_SEPARATOR);
const ownArgv = separator === -1 ? argv : argv.slice(0, separator);
const tenantArgs: TenantArguments = separator === -1 ? [] : argv.slice(separator + 1);

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
    tenantArgs,
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

process.exit(await cli.run(ownArgv));
