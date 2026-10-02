import { trackEvent } from '@repo/analytics';
import { useEffect, useRef } from 'react';
import { useApp } from '#lib/hooks/use-app.ts';
import { useAppTab } from '#lib/hooks/use-app-tab.ts';
import { useSessionIdentity } from '#lib/hooks/use-session-identity.ts';

export function useAppPageAnalytics(appId: string): void {
  const tab = useAppTab();
  const app = useApp(appId);
  const identity = useSessionIdentity();
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    const view = `${appId}/${tab}`;
    if (app.isSuccess && previous.current !== view) {
      previous.current = view;
      trackEvent({ name: 'app_viewed', data: { identity_state: identity, app_id: appId, tab } });
    }
  }, [appId, tab, identity, app.isSuccess]);
}
