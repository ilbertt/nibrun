/**
 * Runs in <head> before first paint. The page is prerendered, so the server cannot know the
 * visitor's preference and a React effect would only run after the wrong theme was already
 * on screen. There is no toggle anywhere in nibrun — the system is the whole story, matching
 * the app's own theme provider.
 */
export const themeScript = `(() => {
  try {
    if (matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark');
    }
  } catch {}
})();`;
