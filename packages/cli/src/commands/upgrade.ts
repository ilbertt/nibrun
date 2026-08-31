import { defineCommand } from '@parshjs/core';
import { installedBinary, upgradeCli } from '#lib/upgrade.ts';

/**
 * The one command that talks to nibrun.com rather than to the api, and so the one that needs no
 * token: a nib too old to sign in is exactly the nib this exists to replace.
 */
export const command = defineCommand('upgrade', {
  description: 'Replace this nib with the newest released one, by running the install again.',
  options: {},
  handler: () => upgradeCli({ binary: installedBinary() }),
});
