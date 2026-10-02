import { useEffect } from 'react';
import { loadTracker } from '#tracker.ts';

export function useAnalytics(): void {
  useEffect(() => {
    void loadTracker();
  }, []);
}
