import { HostnameLink } from '#components/apps/hostname-link.tsx';
import { useAppId } from '#lib/hooks/use-app-id.ts';

export function CurrentAppHostnameLink({ hostname }: { hostname: string }) {
  const appId = useAppId();
  return <HostnameLink hostname={hostname} appId={appId} />;
}
