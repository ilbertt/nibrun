import { trackEvent } from '@repo/analytics';
import type { DeploySuggestion } from '@repo/deploy-link';
import { useEffect, useRef } from 'react';
import { presetForBinary } from '#lib/deployment-analytics.ts';
import { useSessionIdentity } from '#lib/hooks/use-session-identity.ts';

export function useDeployFormAnalytics({
  appId,
  suggested,
}: {
  appId: string | undefined;
  suggested: DeploySuggestion | undefined;
}): void {
  const identity = useSessionIdentity();
  const recorded = useRef(false);
  useEffect(() => {
    if (!recorded.current) {
      recorded.current = true;
      trackEvent({
        name: 'deploy_form_viewed',
        data: {
          identity_state: identity,
          operation: appId === undefined ? 'create' : 'update',
          preset_slug: presetForBinary(suggested?.binary),
        },
      });
    }
  }, [identity, appId, suggested?.binary]);
}
