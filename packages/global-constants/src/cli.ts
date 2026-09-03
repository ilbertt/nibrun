import { WWW_SITE } from '#sites.ts';

export const CLI_INSTALL_SCRIPT_URL = `${WWW_SITE.url}/install.sh`;

export const CLI_INSTALL_COMMAND = `curl -fsSL ${CLI_INSTALL_SCRIPT_URL} | sh`;
