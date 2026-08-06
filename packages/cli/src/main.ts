#!/usr/bin/env bun
import { createCli } from '@parshjs/core';
import { createEnvContext } from '@parshjs/env';
import type { TenantArguments } from '@repo/protocol';
import { z } from 'zod';
import { commandTree } from '#command-tree.gen.ts';

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
        NIB_API_URL: { schema: z.url(), default: 'http://localhost:3000' },
        NIB_API_KEY: { schema: z.string().min(1) },
      },
    }),
    tenantArgs,
  },
});

declare module '@parshjs/core' {
  interface Register {
    cli: typeof cli;
  }
}

process.exit(await cli.run(ownArgv));
