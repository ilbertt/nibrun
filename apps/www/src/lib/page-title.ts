import { PRODUCT_NAME } from '@repo/global-constants';

/** Every page but the landing one, which is named after the site rather than suffixed with it. */
export function pageTitle(name: string): string {
  return `${name} | ${PRODUCT_NAME}`;
}
