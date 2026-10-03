import { trackEvent } from '@repo/analytics';
import { FREE_APPS_COUNT, PRICE_PER_APP_USD } from '@repo/global-constants';
import { type RefObject, useEffect, useRef, useState } from 'react';

const MIN_APPS = 1;
const MAX_APPS = 20;
const BULK_APP_THRESHOLD = 10;
const PRICING_VIEW_THRESHOLD = 0.5;

type PricingCalculator = {
  appCount: number;
  monthly: number;
  volumePricing: boolean;
  headingRef: RefObject<HTMLDivElement | null>;
  fewer: () => void;
  more: () => void;
};

export function usePricing(): PricingCalculator {
  const [appCount, setAppCount] = useState(FREE_APPS_COUNT);
  const headingRef = useRef<HTMLDivElement>(null);
  const viewed = useRef(false);
  const trackedCount = useRef(appCount);

  useEffect(() => {
    if (trackedCount.current !== appCount) {
      trackedCount.current = appCount;
      trackEvent({ name: 'pricing_calculated', data: { app_count: appCount } });
    }
  }, [appCount]);

  useEffect(() => {
    const heading = headingRef.current;
    if (!heading || viewed.current) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          !viewed.current &&
          entries.some(
            (entry) => entry.isIntersecting && entry.intersectionRatio >= PRICING_VIEW_THRESHOLD,
          )
        ) {
          viewed.current = true;
          trackEvent({ name: 'pricing_viewed', data: {} });
          observer.disconnect();
        }
      },
      { threshold: PRICING_VIEW_THRESHOLD },
    );
    observer.observe(heading);
    return () => observer.disconnect();
  }, []);

  function fewer(): void {
    setAppCount((count) => Math.max(MIN_APPS, count - 1));
  }

  function more(): void {
    setAppCount((count) => Math.min(MAX_APPS, count + 1));
  }

  return {
    appCount,
    monthly: Math.max(0, appCount - FREE_APPS_COUNT) * PRICE_PER_APP_USD,
    volumePricing: appCount > BULK_APP_THRESHOLD,
    headingRef,
    fewer,
    more,
  };
}
