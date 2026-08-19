#!/usr/bin/env bun
import { createCli } from '@parshjs/core';
import { commandTree } from '#command-tree.gen.ts';
import { PROGRAM_NAME, PROGRAM_VERSION } from '#config.ts';
import { createCliContext } from '#context.ts';
import { CancelledError } from '#lib/errors.ts';

const cli = createCli({
  programName: PROGRAM_NAME,
  programDescription: 'Run a binary on nibrun.',
  version: PROGRAM_VERSION,
  tree: commandTree,
  context: createCliContext,
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
