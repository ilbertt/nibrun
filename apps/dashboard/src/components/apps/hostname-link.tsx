import { trackEvent } from '@repo/analytics';
import { ExternalLinkIcon } from 'lucide-react';
import { useSessionIdentity } from '#lib/hooks/use-session-identity.ts';

export function HostnameLink({ hostname, appId }: { hostname: string; appId: string }) {
  const identity = useSessionIdentity();
  return (
    <a
      href={`https://${hostname}`}
      target="_blank"
      rel="noreferrer"
      onClick={() =>
        trackEvent({
          name: 'app_open_clicked',
          data: { identity_state: identity, app_id: appId, placement: 'app' },
        })
      }
      className="inline-flex min-w-0 items-center gap-1.5 font-mono hover:underline"
    >
      <span className="truncate">{hostname}</span>
      <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" />
    </a>
  );
}
