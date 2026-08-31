import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/card';
import { CopyButton } from '@repo/ui/custom/copy-button';
import { AppActivation } from '#components/apps/app-activation.tsx';
import { AppEnvironment } from '#components/apps/app-environment.tsx';
import { AppRunCommand } from '#components/apps/app-run-command.tsx';
import { useNewestDeployment } from '#lib/hooks/use-newest-deployment.ts';
import type { AppSummary } from '#queries/apps.ts';

export function AppConfigCard({ app }: { app: AppSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuration</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">HTTP port</span>
          <span className="font-mono tabular-nums">{app.config.httpPort}</span>
        </div>
        {app.config.hasExtraPublicPort && <ReachedOnItsOwnPort appId={app.id} />}
        <AppRunCommand app={app} />
        <AppActivation app={app} />
        <AppEnvironment app={app} />
      </CardContent>
    </Card>
  );
}

/**
 * Where an app that asked for a port besides HTTP is reached, beside the HTTP port it was
 * configured with — the two are the same question asked twice, and an owner looking for one is
 * looking for the other.
 *
 * The address is not configuration and is not here because it is: only the host running the app
 * knows it, so it arrives with the release and there is nothing to show until one is running.
 */
function ReachedOnItsOwnPort({ appId }: { appId: string }) {
  const { publicIpv4, extraPublicPort } = useNewestDeployment(appId).data ?? {};
  return (
    <div className="flex flex-col gap-2">
      {/* Both protocols, always — nibrun never asks which a tenant means to carry over it — so it
          is part of what the row is called rather than something beside the address. */}
      <span className="text-muted-foreground">Additional TCP/UDP address</span>
      {publicIpv4 && extraPublicPort ? (
        // Nothing here links anywhere: it is not a URL, and what an owner does with it is paste it
        // into whatever is dialling the app. Same line as the run command for that reason.
        <ReachedAt address={`${publicIpv4}:${extraPublicPort}`} />
      ) : (
        // Asked for and not yet answered for: the host says where it is on its first report, so
        // this is a release that has not started rather than an address that failed to arrive.
        <span className="text-muted-foreground">assigned when it starts</span>
      )}
    </div>
  );
}

function ReachedAt({ address }: { address: string }) {
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 select-all break-words font-mono text-xs tabular-nums">
        {address}
      </code>
      <CopyButton value={address} />
    </div>
  );
}
