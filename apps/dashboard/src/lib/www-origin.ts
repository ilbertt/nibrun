import { WWW_SITE_DEV_URL, WWW_SITE_URL } from '@repo/global-constants';

// The landing page frames this origin to hand a binary across, and the pages that receive one
// link back to it, so where it lives is named once here rather than once per use.
export const WWW_ORIGIN = import.meta.env.DEV ? WWW_SITE_DEV_URL : WWW_SITE_URL;
