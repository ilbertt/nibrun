/** biome-ignore-all lint/performance/noBarrelFile: index is the only allowed file where we can export other files */

export { CLI_INSTALL_COMMAND, CLI_INSTALL_SCRIPT_URL } from '#cli.ts';
export {
  GITHUB_PACKAGES_URL,
  GITHUB_REPO_NAME,
  GITHUB_REPO_OWNER,
  GITHUB_REPO_SLUG,
  GITHUB_REPO_URL,
} from '#github.ts';
export { FREE_APPS_COUNT, PRICE_PER_APP_USD } from '#pricing.ts';
export {
  BASE_DOMAIN,
  DASHBOARD_SITE,
  HELLO_EMAIL,
  PRODUCT_NAME,
  type Site,
  WWW_SITE,
} from '#sites.ts';
