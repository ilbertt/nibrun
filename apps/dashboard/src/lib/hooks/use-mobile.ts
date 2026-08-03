import { useEffect, useState } from 'react';

// Tailwind's `md` breakpoint, which is where the sidebar switches to a drawer.
const MOBILE_MEDIA_QUERY = '(width < 48rem)';

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_MEDIA_QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(MOBILE_MEDIA_QUERY);
    const syncFromQuery = () => setIsMobile(query.matches);

    query.addEventListener('change', syncFromQuery);
    return () => query.removeEventListener('change', syncFromQuery);
  }, []);

  return isMobile;
}
