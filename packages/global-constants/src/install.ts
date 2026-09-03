import { SITE_URL } from '#site.ts';

/** Where `packages/cli/install.sh` is served from, and so what `nib upgrade` re-runs. */
export const CLI_INSTALL_SCRIPT_URL = `${SITE_URL}/install.sh`;

/** What an owner is told to paste, wherever they are told it. */
export const CLI_INSTALL_COMMAND = `curl -fsSL ${CLI_INSTALL_SCRIPT_URL} | sh`;
