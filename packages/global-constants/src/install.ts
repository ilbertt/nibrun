import { WWW_SITE_URL } from '#sites.ts';

export const CLI_INSTALL_SCRIPT_URL = `${WWW_SITE_URL}/install.sh`;

export const CLI_INSTALL_COMMAND = `curl -fsSL ${CLI_INSTALL_SCRIPT_URL} | sh`;
