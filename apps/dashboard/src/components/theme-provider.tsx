import { type ReactNode, useEffect } from 'react';

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

// The shadcn provider without the parts that only a mode toggle would use: no
// stored preference to read, so the system is the single source of the theme.
export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const prefersDark = window.matchMedia(DARK_MEDIA_QUERY);
    const root = window.document.documentElement;

    const syncFromSystem = () => {
      root.classList.remove('light', 'dark');
      root.classList.add(prefersDark.matches ? 'dark' : 'light');
    };

    syncFromSystem();
    prefersDark.addEventListener('change', syncFromSystem);
    return () => prefersDark.removeEventListener('change', syncFromSystem);
  }, []);

  return children;
}
