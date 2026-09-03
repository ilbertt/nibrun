import { PRODUCT_NAME } from '@repo/global-constants';

export function pageTitle(name: string): string {
  return `${name} | ${PRODUCT_NAME}`;
}
