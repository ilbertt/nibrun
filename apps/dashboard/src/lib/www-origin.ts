import { WWW_SITE } from '@repo/global-constants';

export const WWW_ORIGIN = import.meta.env.DEV ? WWW_SITE.devUrl : WWW_SITE.url;
