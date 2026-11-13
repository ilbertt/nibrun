import { CopyableLine } from '@repo/ui/custom/copyable-line';
import { useNewestDeployment } from '#lib/hooks/use-newest-deployment.ts';

export function AppPublicPortAddress({ appId }: { appId: string }) {
  const { publicIpv4, extraPublicPort } = useNewestDeployment(appId).data ?? {};
  return (
    <div className="flex flex-col gap-2">
      <span className="text-muted-foreground">Additional TCP/UDP address</span>
      {publicIpv4 && extraPublicPort ? (
        <CopyableLine value={`${publicIpv4}:${extraPublicPort}`} prompt={false} />
      ) : (
        <span className="text-muted-foreground">assigned when it starts</span>
      )}
    </div>
  );
}
