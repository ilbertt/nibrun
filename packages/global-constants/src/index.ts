/** biome-ignore-all lint/performance/noBarrelFile: index is the only allowed file where we can export other files */

export {
  GITHUB_PACKAGES_URL,
  GITHUB_REPO_NAME,
  GITHUB_REPO_OWNER,
  GITHUB_REPO_SLUG,
  GITHUB_REPO_URL,
} from '#github.ts';
export { CLI_INSTALL_COMMAND, CLI_INSTALL_SCRIPT_URL } from '#install.ts';
export { FREE_APPS_COUNT, PRICE_PER_APP_USD } from '#pricing.ts';
export {
  CONTACT_EMAIL,
  DASHBOARD_DEV_URL,
  DASHBOARD_URL,
  SITE_DEV_URL,
  SITE_DOMAIN,
  SITE_URL,
} from '#site.ts';
