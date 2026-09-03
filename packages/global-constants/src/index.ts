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
  BASE_DOMAIN,
  CONTACT_EMAIL,
  DASHBOARD_SITE,
  PRODUCT_NAME,
  type Site,
  WWW_SITE,
} from '#sites.ts';
