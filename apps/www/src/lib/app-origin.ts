// The landing page both links to the dashboard and posts a binary into a frame the dashboard
// serves, so where it lives is named once here rather than once per use.
export const APP_ORIGIN = import.meta.env.DEV ? 'http://localhost:3001' : 'https://app.nibrun.com';
