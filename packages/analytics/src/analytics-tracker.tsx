import { useLocation } from '@tanstack/react-router';
import { useEffect } from 'react';
import { loadTracker, trackPage } from '#tracker.ts';

export function AnalyticsTracker({ hostname }: { hostname: string | undefined }): null {
  const pathname = useLocation({ select: (location) => location.pathname });
  useEffect(() => {
    let active = true;
    void loadTracker(hostname).then((loaded) => {
      if (active && loaded) {
        trackPage(pathname);
      }
    });
    return () => {
      active = false;
    };
  }, [hostname, pathname]);
  return null;
}
